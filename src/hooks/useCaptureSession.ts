/**
 * Backs the Talk screen's Capture mode with a real microphone recording and
 * a real `sessions` row: one continuous recording for the whole session,
 * uploaded and transcribed as a single unit when it ends (see
 * supabase/functions/process-session). For the turn-by-turn live chat in
 * Talk's Conversation mode, see useConversationSession.ts instead --
 * capture is a single uninterrupted recording, conversation is a back-and-
 * forth of short turns, and the two don't share enough mechanics to be one
 * hook.
 */
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAudioInterruption, type InterruptionReason } from '@/hooks/useAudioInterruption';
import { ensureBackgroundRecordingAllowed } from '@/lib/backgroundRecording';
import { isNetworkError } from '@/lib/functionsError';
import { useAuth } from '@/providers/AuthProvider';
import { processSession } from '@/services/processing';
import { uploadRecording } from '@/services/recordings';
import { createSession, deleteSession, endSession } from '@/services/sessions';

// Stopping the native recorder within roughly the first second of starting
// it can throw and/or leave a corrupt, zero-duration file behind (a known
// Android MediaRecorder quirk) -- always pad a stop out to at least this long.
const MIN_RECORDING_MS = 800;

// Speech-only recording, sent to Whisper: mono 64 kbps AAC (~0.5 MB/min)
// keeps even a ~45-minute unbroken segment under Whisper's 25 MB file
// limit. The stock HIGH_QUALITY preset (stereo 128 kbps, ~1 MB/min) hit
// that limit at ~25 minutes and the whole session then failed to process.
export const SPEECH_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64000,
};

export function useCaptureSession() {
  const { user } = useAuth();
  const [saveOnly, setSaveOnly] = useState(false);
  const [everRecorded, setEverRecorded] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  // Guards toggleRecording against overlapping calls -- a stop is padded
  // out to MIN_RECORDING_MS before it actually happens (see
  // stopRecorderSafely), and recorder.isRecording stays true for that
  // whole window, so a second tap during it would otherwise also read
  // "recording" and race the first call's stop.
  const toggleBusyRef = useRef(false);
  // Mirrors toggleBusyRef for the UI, and lets endCapture wait for a
  // pause's upload to finish instead of racing it.
  const [toggleBusy, setToggleBusy] = useState(false);
  const togglePromiseRef = useRef<Promise<boolean> | null>(null);
  // Why the recording is paused when it wasn't the user who paused it --
  // cleared the next time recording starts.
  const [interruption, setInterruption] = useState<InterruptionReason | null>(null);
  // True once the OS has agreed to let this recording continue in the
  // background (foreground service + notification on Android). Decides
  // whether leaving the app pauses the recording or not.
  const backgroundAllowedRef = useRef(false);
  // True once this session actually has something worth keeping (recording
  // has started at least once) -- lets the unmount cleanup below tell "the
  // user left before recording anything" (safe to delete) from "the user
  // left mid-capture without tapping Done or Cancel" (must NOT be silently
  // discarded).
  const hasContentRef = useRef(false);

  const recorder = useAudioRecorder(SPEECH_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 200);

  const recording = recorderState.isRecording;
  const seconds = Math.floor(recorderState.durationMillis / 1000);
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current || !user) return sessionIdRef.current;
    const session = await createSession(user.id, 'capture');
    sessionIdRef.current = session.id;
    return session.id;
  }, [user]);

  /** Pads out to MIN_RECORDING_MS if needed, then stops -- a stop attempted
   *  too soon after starting can throw and/or leave a corrupt, zero-duration
   *  file behind, so every stop site goes through this instead of calling
   *  recorder.stop() directly. */
  const stopRecorderSafely = useCallback(async () => {
    const elapsed = Date.now() - (recordingStartedAtRef.current ?? 0);
    if (elapsed < MIN_RECORDING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS - elapsed));
    }
    try {
      await recorder.stop();
    } catch {
      // The native recorder can throw on stop (e.g. it was already
      // winding down on its own) -- treat it as stopped either way
      // rather than leaving the UI stuck mid-recording.
    }
  }, [recorder]);

  /** Returns false when this segment could NOT be saved, so callers (pause,
   *  Done, the unmount cleanup below) can tell that apart from a real
   *  success instead of silently treating a swallowed upload failure as if
   *  everything had been captured. */
  const uploadCurrentSegment = useCallback(async (): Promise<boolean> => {
    const uri = recorder.uri;
    const sessionId = sessionIdRef.current;
    if (!uri || !sessionId || !user) return true; // nothing was recorded -- not a failure
    try {
      await uploadRecording(user.id, sessionId, uri);
      return true;
    } catch (e) {
      if (isNetworkError(e)) {
        try {
          await uploadRecording(user.id, sessionId, uri);
          return true;
        } catch {
          // Falls through to the alert below.
        }
      }
      Alert.alert(
        'Part of this recording was not saved',
        (e instanceof Error ? e.message : 'Could not upload this recording.') +
          ' Everything recorded before this point is safe.'
      );
      return false;
    }
  }, [recorder, user]);

  /** Starts recording, or pauses it -- this never ends the session or
   *  navigates anywhere; see endCapture for that. Returns true when this
   *  call paused it. */
  const toggleRecording = useCallback(async (): Promise<boolean> => {
    if (toggleBusyRef.current) return false;
    toggleBusyRef.current = true;
    setToggleBusy(true);
    const run = async () => {
      try {
        if (recorder.isRecording) {
          await stopRecorderSafely();
          await uploadCurrentSegment();
          return true;
        }

        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            'Microphone access needed',
            'Mind Record needs microphone access to record. You can enable it in Settings.'
          );
          return false;
        }

        try {
          await ensureSession();
          // Asked once per run, on the first start; Android remembers the
          // answer so later starts don't prompt again.
          const backgroundAllowed = backgroundAllowedRef.current || (await ensureBackgroundRecordingAllowed());
          backgroundAllowedRef.current = backgroundAllowed;
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
            allowsBackgroundRecording: backgroundAllowed,
          });
          await recorder.prepareToRecordAsync();
          recorder.record();
          recordingStartedAtRef.current = Date.now();
          hasContentRef.current = true;
          setEverRecorded(true);
          setInterruption(null);
        } catch (e) {
          Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
        }
        return false;
      } finally {
        toggleBusyRef.current = false;
        setToggleBusy(false);
      }
    };
    const promise = run();
    togglePromiseRef.current = promise;
    const result = await promise;
    if (togglePromiseRef.current === promise) togglePromiseRef.current = null;
    return result;
  }, [recorder, ensureSession, uploadCurrentSegment, stopRecorderSafely]);

  /** Stops recording if active, uploads any final segment, marks the
   *  session ended, and kicks off transcription/AI analysis in the
   *  background. This is the only thing that actually ends a capture and
   *  is safe to navigate to Summary after -- toggleRecording on its own
   *  only pauses/resumes. Returns the session id that was ended (or null
   *  if nothing was ever recorded), so the caller can pass it to Summary. */
  const endCapture = useCallback(async (): Promise<string | null> => {
    // A pause tapped a moment ago may still be padding its stop or
    // uploading its segment; ending on top of that would stop/upload the
    // same file twice, or end the session before its last segment exists.
    if (togglePromiseRef.current) {
      await togglePromiseRef.current.catch(() => false);
    }
    let lastSegmentSaved = true;
    if (recorder.isRecording) {
      await stopRecorderSafely();
      lastSegmentSaved = await uploadCurrentSegment();
    }
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) {
      try {
        await endSession(sessionId);
      } catch (e) {
        Alert.alert('Could not finish saving', e instanceof Error ? e.message : 'Please try again.');
      }
      if (!lastSegmentSaved) {
        // uploadCurrentSegment already explained the failure -- this just
        // makes clear that what follows (summary/tasks/ideas) reflects only
        // what was actually saved, not the whole recording.
        Alert.alert(
          'Continuing with what was saved',
          'The last part of this recording is missing, so the summary below may be incomplete.'
        );
      }
      // Not awaited: transcription + AI analysis can take a while, and
      // Summary polls sessions.processing_status itself rather than
      // blocking the screen transition on this call.
      processSession(sessionId).catch((e) => {
        Alert.alert(
          'Could not process this recording',
          e instanceof Error ? e.message : 'Please try again.'
        );
      });
    }
    return sessionId;
  }, [recorder, uploadCurrentSegment, stopRecorderSafely]);

  /** Stops recording if active and discards the whole session -- no
   *  transcription, no summary, the audio is deleted. This is Cancel, not
   *  a quiet version of finishing; use endCapture to actually keep what
   *  was recorded. */
  const cancelCapture = useCallback(async (): Promise<void> => {
    if (recorder.isRecording) {
      await stopRecorderSafely();
    }
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    hasContentRef.current = false;
    setEverRecorded(false);
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch {
        // Best-effort -- the user is already leaving the screen either way.
      }
    }
  }, [recorder, stopRecorderSafely]);

  // Losing the mic (app backgrounded, native recorder error) is handled as
  // a pause: the segment recorded so far is finalized and uploaded exactly
  // as if the user had tapped pause, so nothing said before the
  // interruption is lost, and the screen explains why it stopped.
  useAudioInterruption(recorder, (reason) => {
    if (!recorder.isRecording || toggleBusyRef.current) return;
    // With the foreground service running, backgrounding is not an
    // interruption at all -- the whole point is to keep recording.
    if (reason === 'background' && backgroundAllowedRef.current) return;
    setInterruption(reason);
    toggleRecording().catch(() => {
      // toggleRecording reports its own failures.
    });
  });

  // Leaving the screen mid-capture (Android back, swipe) must NOT silently
  // destroy what was already recorded -- only a session that never actually
  // started recording (nothing to lose) is safe to delete here. Anything
  // with real content is instead saved exactly like tapping Done: stop and
  // upload whatever segment is still active, then end + process the session.
  useEffect(
    () => () => {
      const orphan = sessionIdRef.current;
      sessionIdRef.current = null;
      if (!orphan) return;
      if (!hasContentRef.current) {
        deleteSession(orphan).catch(() => {
          // Best-effort cleanup on the way out.
        });
        return;
      }
      (async () => {
        try {
          if (recorder.isRecording) {
            await recorder.stop();
            await uploadCurrentSegment();
          }
        } catch {
          // Best-effort -- saving the session either way.
        }
        try {
          await endSession(orphan);
        } catch {
          // Best-effort -- can't surface an alert once the screen is gone.
        }
        processSession(orphan).catch(() => {
          // Best-effort -- Summary/Retry can pick this up later if it failed.
        });
      })();
    },
    [recorder, uploadCurrentSegment]
  );

  return {
    recording,
    everRecorded,
    toggleBusy,
    interruption,
    saveOnly,
    toggleSaveOnly: () => setSaveOnly((s) => !s),
    toggleRecording,
    endCapture,
    cancelCapture,
    timer,
  };
}
