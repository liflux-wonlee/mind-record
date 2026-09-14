/**
 * Backs the Talk/Driving capture screens with a real microphone recording
 * and a real `sessions` row. Talk/Driving used to run on `src/store.tsx`'s
 * fake interval timer; that's been replaced here with expo-audio's actual
 * recorder, Supabase Storage upload (`src/services/recordings.ts`), and
 * real session create/end calls (`src/services/sessions.ts`).
 *
 * Still mock: the transcript lines revealed while "listening" and the AI
 * reply text in app/talk.tsx — those need real speech-to-text and an AI
 * pass, which is a later phase. This phase only makes the recording
 * itself, its storage, and the session record real; `lines`/`timer` below
 * are now driven by the *real* elapsed recording time, but the scripted
 * transcript content shown against them is still the same placeholder copy
 * as before.
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
import { uploadRecording } from '@/services/recordings';
import { createSession, endSession } from '@/services/sessions';
import type { SessionMode } from '@/types/database';

type CaptureMode = 'capture' | 'conv';
type RelatedState = null | 'linked' | 'dismissed';

/** Pass 'driving' for the Driving screen — it has no Capture/Conversation
 *  toggle and always records under a `driving` session. Omit it for Talk,
 *  where the toggle picks capture vs. conversation. */
export function useCaptureSession(fixedSessionMode?: Extract<SessionMode, 'driving'>) {
  const { user } = useAuth();
  const [mode, setMode] = useState<CaptureMode>('capture');
  const [saveOnly, setSaveOnly] = useState(false);
  const [related, setRelated] = useState<RelatedState>(null);
  const [everRecorded, setEverRecorded] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);

  const recording = recorderState.isRecording;
  const seconds = Math.floor(recorderState.durationMillis / 1000);
  const timer = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const lines = recording || everRecorded ? Math.min(3, Math.floor(seconds / 3)) : 0;

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current || !user) return sessionIdRef.current;
    const sessionMode: SessionMode = fixedSessionMode ?? (mode === 'capture' ? 'capture' : 'conversation');
    const session = await createSession(user.id, sessionMode);
    sessionIdRef.current = session.id;
    return session.id;
  }, [fixedSessionMode, mode, user]);

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

  /** Stops recording if active, uploads any final segment, and marks the
   *  session ended. Call this at every point the capture flow is left
   *  (End/Exit buttons, or after toggleRecording reports a stop that leads
   *  straight to Summary) — never leave the recorder running unattended. */
  const endCapture = useCallback(async () => {
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
    }
  }, [recorder, uploadCurrentSegment]);

  return {
    mode,
    setMode,
    recording,
    everRecorded,
    saveOnly,
    toggleSaveOnly: () => setSaveOnly((s) => !s),
    related,
    setRelated,
    toggleRecording,
    endCapture,
    lines,
    timer,
  };
}
