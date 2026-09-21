/**
 * Voice input FOR Search (app/(tabs)/search.tsx) -- a single tap-to-record,
 * tap-to-ask question, not a hands-free loop like Talk's Conversation mode
 * and not a new recording saved anywhere. The mic button on Search used to
 * just navigate to /talk, which is exactly what the spec calls out as
 * wrong: this hook is what makes that button actually search by voice
 * instead of redirecting to a different feature.
 *
 * Shares the same STT (search-ask transcribes server-side, same as
 * converse), personalization (voice/locale from `profiles`, applied
 * server-side), and interruption-handling code as voice conversation --
 * recording/playback both stop immediately on backgrounding, matching the
 * app-wide "AI voice interaction never continues while backgrounded" rule.
 */
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAudioInterruption, type InterruptionReason } from '@/hooks/useAudioInterruption';
import { SPEECH_RECORDING_OPTIONS, waitForRecorderUri } from '@/hooks/useCaptureSession';
import { friendlyMessage } from '@/lib/friendlyError';
import { withSystemDialog } from '@/lib/systemDialogGuard';
import { useAuth } from '@/providers/AuthProvider';
import {
  askSearchQuestion,
  uploadSearchQuestionAudio,
  type SearchAnswerResult,
  type SearchTurn,
} from '@/services/searchAnswer';

export type VoiceSearchState = 'idle' | 'recording' | 'thinking' | 'speaking';

// Same Android MediaRecorder quirk as Capture/Conversation: a stop attempted
// too soon after starting can throw or leave a corrupt file.
const MIN_RECORDING_MS = 800;

export function useVoiceSearch(
  onResult: (result: SearchAnswerResult) => void,
  history: SearchTurn[],
  muted = false
) {
  const { user } = useAuth();
  const [state, setState] = useState<VoiceSearchState>('idle');
  const [interruption, setInterruption] = useState<InterruptionReason | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  // Read fresh inside the async ask-flow without needing it in that
  // callback's own dependency array.
  const historyRef = useRef(history);
  historyRef.current = history;
  const stateRef = useRef<VoiceSearchState>('idle');
  stateRef.current = state;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const recorder = useAudioRecorder(SPEECH_RECORDING_OPTIONS);
  const player = useAudioPlayer(null);

  const startRecording = useCallback(async () => {
    if (stateRef.current !== 'idle' || !user) return;
    const permission = await withSystemDialog(() => requestRecordingPermissionsAsync());
    if (!permission.granted) {
      Alert.alert(
        'Microphone access needed',
        'Mind Record needs microphone access to search by voice. You can enable it in Settings.'
      );
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingStartedAtRef.current = Date.now();
      setInterruption(null);
      setState('recording');
    } catch (e) {
      Alert.alert('Could not start recording', friendlyMessage(e, 'Please try again.'));
    }
  }, [recorder, user]);

  const cancelRecording = useCallback(async () => {
    if (stateRef.current !== 'recording') return;
    try {
      await recorder.stop();
    } catch {
      // Best-effort -- discarding either way.
    }
    setState('idle');
  }, [recorder]);

  const stopRecordingAndAsk = useCallback(async () => {
    if (stateRef.current !== 'recording' || !user) return;
    setState('thinking');
    try {
      const elapsed = Date.now() - (recordingStartedAtRef.current ?? 0);
      if (elapsed < MIN_RECORDING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS - elapsed));
      }
      try {
        await recorder.stop();
      } catch {
        // The native recorder can throw on stop -- press on with whatever
        // it captured rather than leaving the screen stuck on "Listening…"
      }
      const uri = await waitForRecorderUri(recorder);
      if (!uri) throw new Error("Didn't catch that. Please try again.");
      const storagePath = await uploadSearchQuestionAudio(user.id, uri);
      const result = await askSearchQuestion({ storagePath, history: historyRef.current });
      onResult(result);
      if (result.audioBase64 && !mutedRef.current) {
        const file = new File(Paths.cache, `search-answer-${Date.now()}.mp3`);
        file.write(result.audioBase64, { encoding: 'base64' });
        player.replace(file.uri);
        player.play();
        setState('speaking');
      } else {
        setState('idle');
      }
    } catch (e) {
      Alert.alert('Could not answer that', friendlyMessage(e, 'Please try again.'));
      setState('idle');
    }
  }, [user, recorder, player, onResult]);

  const stopSpeaking = useCallback(() => {
    player.pause();
    if (stateRef.current === 'speaking') setState('idle');
  }, [player]);

  // Losing the mic/app foreground mid-question or mid-answer stops
  // everything immediately rather than carrying on in the background --
  // same policy as voice conversation. A late-arriving question just gets
  // discarded; there's no partial state worth preserving for a single
  // short question the way there is for a whole journal entry.
  useAudioInterruption(recorder, (reason) => {
    if (stateRef.current === 'idle') return;
    setInterruption(reason);
    if (recorder.isRecording) {
      recorder.stop().catch(() => {});
    }
    player.pause();
    setState('idle');
  });

  useEffect(() => {
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && stateRef.current === 'speaking') setState('idle');
    });
    return () => subscription.remove();
  }, [player]);

  return { state, interruption, startRecording, stopRecordingAndAsk, cancelRecording, stopSpeaking };
}
