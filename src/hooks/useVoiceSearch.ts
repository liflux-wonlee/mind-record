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
import { DIRECT_AUDIO_MAX_BYTES, DIRECT_AUDIO_UPLOAD_ENABLED } from '@/lib/featureFlags';
import { friendlyMessage } from '@/lib/friendlyError';
import { startPerfTurn, type PerfTurn } from '@/lib/perfLog';
import { withSystemDialog } from '@/lib/systemDialogGuard';
import { useAuth } from '@/providers/AuthProvider';
import { readRecordingBase64 } from '@/services/recordings';
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
  // Latency instrumentation (see src/lib/perfLog.ts) -- same pattern as
  // useConversationSession.ts.
  const currentTurnRef = useRef<PerfTurn | null>(null);
  const firstPlayMarkedRef = useRef(false);
  const lastTurnMetaRef = useRef<{ audioPath: 'direct' | 'storage' } | null>(null);

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
      currentTurnRef.current = startPerfTurn('search_voice');
      firstPlayMarkedRef.current = false;
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
    const perf = currentTurnRef.current;
    perf?.mark('stop_requested');
    let audioPath: 'direct' | 'storage' = 'storage';
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
      perf?.mark('recorder_stopped');
      const uri = await waitForRecorderUri(recorder);
      if (!uri) throw new Error("Didn't catch that. Please try again.");
      perf?.mark('file_ready');

      // Same direct-send-when-small pattern as useConversationSession.ts --
      // a search question has no durability tradeoff either way (see
      // search-ask/index.ts: it was never saved as a recording on the old
      // Storage-upload path, and isn't on this one).
      let result: SearchAnswerResult | undefined;
      if (DIRECT_AUDIO_UPLOAD_ENABLED) {
        const { base64, byteLength } = await readRecordingBase64(uri);
        if (byteLength > 0 && byteLength <= DIRECT_AUDIO_MAX_BYTES) {
          perf?.mark('audio_read');
          audioPath = 'direct';
          result = await askSearchQuestion({
            audioBase64: base64,
            mimeType: 'audio/m4a',
            turnId: perf?.turnId,
            history: historyRef.current,
          });
        }
      }
      if (!result) {
        const storagePath = await uploadSearchQuestionAudio(user.id, uri);
        perf?.mark('uploaded');
        audioPath = 'storage';
        result = await askSearchQuestion({ storagePath, history: historyRef.current });
      }
      perf?.mark('function_call_done');
      onResult(result);
      if (result.audioBase64 && !mutedRef.current) {
        const file = new File(Paths.cache, `search-answer-${Date.now()}.mp3`);
        file.write(result.audioBase64, { encoding: 'base64' });
        perf?.mark('reply_file_written');
        player.replace(file.uri);
        player.play();
        perf?.mark('play_called');
        lastTurnMetaRef.current = { audioPath };
        setState('speaking');
      } else {
        setState('idle');
        perf?.finish({ audioPath, muted: mutedRef.current, hadAudio: !!result.audioBase64 });
        currentTurnRef.current = null;
      }
    } catch (e) {
      Alert.alert('Could not answer that', friendlyMessage(e, 'Please try again.'));
      setState('idle');
      perf?.finish({ audioPath, error: true });
      currentTurnRef.current = null;
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
      if (status.playing && !firstPlayMarkedRef.current && stateRef.current === 'speaking') {
        firstPlayMarkedRef.current = true;
        currentTurnRef.current?.mark('first_native_playing');
      }
      if (status.didJustFinish && stateRef.current === 'speaking') {
        setState('idle');
        const turn = currentTurnRef.current;
        turn?.mark('reply_finished');
        turn?.finish({
          ...lastTurnMetaRef.current,
          stopRequestedToFirstAudioMs: turn.msFrom('stop_requested', 'first_native_playing'),
        });
        currentTurnRef.current = null;
      }
    });
    return () => subscription.remove();
  }, [player]);

  return { state, interruption, startRecording, stopRecordingAndAsk, cancelRecording, stopSpeaking };
}
