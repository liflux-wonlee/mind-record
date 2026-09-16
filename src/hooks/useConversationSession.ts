/**
 * Backs Talk's Conversation mode: a real turn-based voice chat, not a
 * single continuous recording (see useCaptureSession.ts for that). Each
 * turn is its own short recording -- start, speak, stop -- which gets
 * uploaded and sent to the `converse` Edge Function (transcribe -> GPT
 * reply, using the session's full message history for context -> TTS).
 * The reply is written to a local file (expo-file-system) so expo-audio's
 * player can play it back, then the turn loop returns to idle for the next
 * one.
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

export function useConversationSession() {
  const { user } = useAuth();
  const [state, setState] = useState<ConversationState>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const sessionIdRef = useRef<string | null>(null);

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
      await recorder.prepareToRecordAsync();
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
