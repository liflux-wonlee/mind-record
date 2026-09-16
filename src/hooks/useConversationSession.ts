/**
 * Backs Talk's Conversation mode: a real turn-based voice chat, not a
 * single continuous recording (see useCaptureSession.ts for that). Each
 * turn is its own short recording -- start, speak, and then either a pause
 * in speech auto-ends the turn, or the user taps the button to end it
 * manually -- which gets uploaded and sent to the `converse` Edge Function
 * (transcribe -> GPT reply, using the session's full message history for
 * context -> TTS). The reply is written to a local file (expo-file-system)
 * so expo-audio's player can play it back, then the turn loop returns to
 * idle for the next one.
 *
 * The auto-stop is a simple silence timer over the recorder's metering
 * (dB) level, not real voice-activity detection -- it's a heuristic tuned
 * for "a normal pause after finishing a sentence," and may need
 * SILENCE_THRESHOLD_DB/SILENCE_DURATION_MS adjusted after real-device
 * testing (too eager: cuts off mid-thought; too lax: never fires in a
 * noisy room). Tapping the button always still ends the turn immediately
 * as a manual override either way.
 *
 * expo-file-system's config plugin only adds Android storage permissions
 * and iOS document-sharing flags that this hook doesn't need -- it only
 * ever touches the app's own private cache directory, which needs neither
 * -- so it's deliberately left out of app.json, the same call made for
 * @react-native-google-signin/google-signin (see src/services/auth.ts).
 */
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { converseTurn } from '@/services/conversation';
import { processSession } from '@/services/processing';
import { uploadRecording } from '@/services/recordings';
import { createSession, endSession } from '@/services/sessions';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type ConversationState = 'idle' | 'recording' | 'thinking' | 'speaking';

// Metering is in dBFS (0 = loudest, more negative = quieter); typical room
// noise/breathing sits well below -35dB on a phone mic.
const SILENCE_THRESHOLD_DB = -35;
const SILENCE_DURATION_MS = 1500;

export function useConversationSession() {
  const { user } = useAuth();
  const [state, setState] = useState<ConversationState>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  // A reply finishing playback hands the turn back to the user.
  useEffect(() => {
    if (state === 'speaking' && playerStatus.didJustFinish) {
      setState('idle');
    }
  }, [state, playerStatus.didJustFinish]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current || !user) return sessionIdRef.current;
    const session = await createSession(user.id, 'conversation');
    sessionIdRef.current = session.id;
    return session.id;
  }, [user]);

  const startTurn = useCallback(async () => {
    if (state !== 'idle') return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Microphone access needed',
        'Mind Record needs microphone access to talk with you. You can enable it in Settings.'
      );
      return;
    }
    try {
      await ensureSession();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync({ isMeteringEnabled: true });
      recorder.record();
      setState('recording');
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
    }
  }, [state, recorder, ensureSession]);

  const stopTurn = useCallback(async () => {
    if (state !== 'recording' || !user) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    await recorder.stop();
    setState('thinking');

    try {
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio was captured for that turn.');
      const attachment = await uploadRecording(user.id, sessionId, uri);
      const result = await converseTurn(sessionId, attachment.storage_path);

      setTurns((prev) => {
        const next = [...prev];
        if (result.userText) next.push({ role: 'user', content: result.userText });
        next.push({ role: 'assistant', content: result.assistantText });
        return next;
      });

      const replyFile = new File(Paths.cache, `mind-record-reply-${Date.now()}.mp3`);
      replyFile.write(result.audioBase64, { encoding: 'base64' });
      player.replace(replyFile.uri);
      player.play();
      setState('speaking');
    } catch (e) {
      Alert.alert('Could not process that', e instanceof Error ? e.message : 'Please try again.');
      setState('idle');
    }
  }, [state, user, recorder, player]);

  // Auto-ends the turn after a pause in speech, so the user doesn't have
  // to tap the button every time -- see the file header for the caveats.
  useEffect(() => {
    if (state !== 'recording') {
      hasSpokenRef.current = false;
      silenceStartRef.current = null;
      return;
    }
    const level = recorderState.metering;
    if (level === undefined) return;

    if (level > SILENCE_THRESHOLD_DB) {
      hasSpokenRef.current = true;
      silenceStartRef.current = null;
      return;
    }
    if (!hasSpokenRef.current) return; // hasn't started talking yet -- don't count this as a pause
    if (silenceStartRef.current === null) {
      silenceStartRef.current = Date.now();
      return;
    }
    if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
      stopTurn();
    }
  }, [state, recorderState.metering, stopTurn]);

  /** Stops any in-flight turn/playback, ends the session, and kicks off
   *  process-session in the background (it reuses the transcript already
   *  captured turn-by-turn instead of re-transcribing). Returns the
   *  session id (or null if the conversation never really started). */
  const endConversation = useCallback(async (): Promise<string | null> => {
    if (recorderState.isRecording) {
      await recorder.stop();
    }
    player.pause();

    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) {
      try {
        await endSession(sessionId);
      } catch (e) {
        Alert.alert('Could not finish saving', e instanceof Error ? e.message : 'Please try again.');
      }
      processSession(sessionId).catch((e) => {
        Alert.alert(
          'Could not process this recording',
          e instanceof Error ? e.message : 'Please try again.'
        );
      });
    }
    return sessionId;
  }, [recorder, recorderState.isRecording, player]);

  return {
    state,
    turns,
    startTurn,
    stopTurn,
    endConversation,
  };
}
