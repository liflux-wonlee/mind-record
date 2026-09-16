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
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { processSession } from '@/services/processing';
import { uploadRecording } from '@/services/recordings';
import { createSession, deleteSession, endSession } from '@/services/sessions';

export function useCaptureSession() {
  const { user } = useAuth();
  const [saveOnly, setSaveOnly] = useState(false);
  const [everRecorded, setEverRecorded] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
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

  const uploadCurrentSegment = useCallback(async () => {
    const uri = recorder.uri;
    const sessionId = sessionIdRef.current;
    if (!uri || !sessionId || !user) return;
    try {
      await uploadRecording(user.id, sessionId, uri);
    } catch (e) {
      Alert.alert(
        'Recording not saved',
        e instanceof Error ? e.message : 'Could not upload this recording. Please try again.'
      );
    }
  }, [recorder, user]);

  /** Starts recording, or stops it. Returns true when this call stopped it. */
  const toggleRecording = useCallback(async (): Promise<boolean> => {
    if (recorder.isRecording) {
      await recorder.stop();
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
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setEverRecorded(true);
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
    }
    return false;
  }, [recorder, ensureSession, uploadCurrentSegment]);

  /** Stops recording if active, uploads any final segment, marks the
   *  session ended, and kicks off transcription/AI analysis in the
   *  background. Call this at every point the capture flow is left
   *  (End/Exit buttons, or after toggleRecording reports a stop that leads
   *  straight to Summary) — never leave the recorder running unattended.
   *  Returns the session id that was ended (or null if nothing was ever
   *  recorded), so the caller can pass it to Summary. */
  const endCapture = useCallback(async (): Promise<string | null> => {
    if (recorder.isRecording) {
      await recorder.stop();
      await uploadCurrentSegment();
    }
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) {
      try {
        await endSession(sessionId);
      } catch (e) {
        Alert.alert('Could not finish saving', e instanceof Error ? e.message : 'Please try again.');
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
  }, [recorder, uploadCurrentSegment]);

  /** Stops recording if active and discards the whole session -- no
   *  transcription, no summary, the audio is deleted. This is Cancel, not
   *  a quiet version of finishing; use endCapture to actually keep what
   *  was recorded. */
  const cancelCapture = useCallback(async (): Promise<void> => {
    if (recorder.isRecording) {
      await recorder.stop();
    }
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    setEverRecorded(false);
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch {
        // Best-effort -- the user is already leaving the screen either way.
      }
    }
  }, [recorder]);

  return {
    recording,
    everRecorded,
    saveOnly,
    toggleSaveOnly: () => setSaveOnly((s) => !s),
    toggleRecording,
    endCapture,
    cancelCapture,
    timer,
  };
}
