/**
 * Backs Talk's Conversation mode: a real, continuous turn-based voice chat
 * (not a single continuous recording -- see useCaptureSession.ts for
 * that). The user taps once to begin; after that it's hands-free: speak,
 * a pause auto-ends the turn (or the user can still tap to force it), the
 * turn is sent to the `converse` Edge Function (transcribe -> GPT reply
 * using the session's full message history for context -> TTS), the
 * reply plays, and listening restarts automatically -- no tap needed
 * between turns. It keeps going until the user says something like
 * "저장하고 끝내" (converse's GPT call recognizes this and sets
 * `shouldEnd`) or taps Cancel/End on screen.
 *
 * The auto-stop-per-turn is a simple silence timer over the recorder's
 * metering (dB) level, not real voice-activity detection -- it's a
 * heuristic tuned for "a normal pause after finishing a sentence," and
 * may need SILENCE_THRESHOLD_DB/SILENCE_DURATION_MS adjusted after
 * real-device testing (too eager: cuts off mid-thought; too lax: never
 * fires in a noisy room). Tapping the button always still ends the turn
 * immediately as a manual override either way. The check itself runs on
 * its own setInterval rather than off a useEffect keyed on the metering
 * value -- during a real silence the metering level tends to settle on
 * one repeated dB reading, and a value-keyed effect simply never re-fires
 * when its dependency stops changing, which silently stalled the whole
 * auto-stop path.
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
import { createSession, deleteSession, endSession } from '@/services/sessions';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type ConversationState = 'idle' | 'recording' | 'thinking' | 'speaking';

// Metering is in dBFS (0 = loudest, more negative = quieter); typical room
// noise/breathing sits well below -35dB on a phone mic.
const SILENCE_THRESHOLD_DB = -35;
const SILENCE_DURATION_MS = 1500;
// Stopping the native recorder within roughly the first second of starting
// it can throw and/or leave a corrupt, zero-duration file behind (a known
// Android MediaRecorder quirk) -- always pad a stop out to at least this long.
const MIN_RECORDING_MS = 800;

async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

/** @param onAutoEnded called when the AI itself detected a spoken "end and save" -- after the closing reply finishes playing and the session is already saved/queued for processing. */
export function useConversationSession(onAutoEnded?: (sessionId: string | null) => void) {
  const { user } = useAuth();
  const [state, setState] = useState<ConversationState>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  // Guards stopTurn against overlapping calls -- the silence interval below
  // ticks every 200ms independent of how far a previous stopTurn() call has
  // gotten, and `state` itself doesn't update until well after that call
  // starts, so the `state !== 'recording'` check alone can't tell "already
  // stopping" from "not yet stopped".
  const stoppingRef = useRef(false);
  // Mirrors the latest metering reading every render so the silence-check
  // interval below always sees a fresh value without needing to be torn
  // down and recreated on every single poll tick.
  const meteringRef = useRef<number | undefined>(undefined);
  // Once true, the loop keeps re-listening after every reply on its own.
  const activeRef = useRef(false);
  // Set right before returning to idle, so the *next* idle commit knows to auto-restart.
  const autoRestartRef = useRef(false);
  // Set when converse's GPT call says the user just asked to end and save.
  const pendingEndRef = useRef(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  meteringRef.current = recorderState.metering;
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current || !user) return sessionIdRef.current;
    const session = await createSession(user.id, 'conversation');
    sessionIdRef.current = session.id;
    return session.id;
  }, [user]);

  /** Stops any in-flight turn/playback, ends the session, and kicks off
   *  process-session in the background (it reuses the transcript already
   *  captured turn-by-turn instead of re-transcribing). Returns the
   *  session id (or null if the conversation never really started). */
  const endConversation = useCallback(async (): Promise<string | null> => {
    activeRef.current = false;
    if (recorderState.isRecording) {
      try {
        await recorder.stop();
      } catch {
        // Best-effort -- we're ending the conversation either way.
      }
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

  /** Stops any in-flight turn/playback and discards the whole
   *  conversation -- no processing, the audio and any transcript captured
   *  so far are deleted. This is Cancel, not a quiet version of ending;
   *  use endConversation to actually keep what was said. */
  const cancelConversation = useCallback(async (): Promise<void> => {
    activeRef.current = false;
    if (recorderState.isRecording) {
      try {
        await recorder.stop();
      } catch {
        // Best-effort -- discarding the conversation either way.
      }
    }
    player.pause();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    setTurns([]);
    setState('idle');
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch {
        // Best-effort -- the user is already leaving the screen either way.
      }
    }
  }, [recorder, recorderState.isRecording, player]);

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
      recordingStartedAtRef.current = Date.now();
      activeRef.current = true;
      setState('recording');
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : 'Please try again.');
    }
  }, [state, recorder, ensureSession]);

  const stopTurn = useCallback(async () => {
    if (state !== 'recording' || !user || stoppingRef.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    stoppingRef.current = true;

    try {
      const elapsed = Date.now() - (recordingStartedAtRef.current ?? 0);
      if (elapsed < MIN_RECORDING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS - elapsed));
      }

      try {
        await recorder.stop();
      } catch {
        // The native recorder can throw on stop (e.g. it was already
        // winding down on its own) -- press on and try to use whatever it
        // captured rather than leaving the turn stuck on "Listening…"
        // forever, which is what silently swallowing this used to do.
      }
      setState('thinking');

      const uri = recorder.uri;
      if (!uri) throw new Error('No audio was captured for that turn.');
      const attachment = await uploadRecording(user.id, sessionId, uri);
      // The audio is already safely uploaded by this point -- retrying
      // just the transcribe+reply call costs nothing extra on a transient
      // network hiccup instead of losing the turn outright.
      const result = await withOneRetry(() => converseTurn(sessionId, attachment.storage_path));

      setTurns((prev) => {
        const next = [...prev];
        if (result.userText) next.push({ role: 'user', content: result.userText });
        next.push({ role: 'assistant', content: result.assistantText });
        return next;
      });
      pendingEndRef.current = result.shouldEnd;

      const replyFile = new File(Paths.cache, `mind-record-reply-${Date.now()}.mp3`);
      replyFile.write(result.audioBase64, { encoding: 'base64' });
      player.replace(replyFile.uri);
      player.play();
      setState('speaking');
    } catch (e) {
      Alert.alert(
        'Could not process that',
        (e instanceof Error ? e.message : 'Please try again.') +
          ' 이 발언은 저장되지 않았을 수 있어요.'
      );
      setState('idle');
    } finally {
      stoppingRef.current = false;
    }
  }, [state, user, recorder, player]);

  // Auto-ends the turn after a pause in speech, so the user doesn't have
  // to tap the button every time -- see the file header for the caveats,
  // and for why this runs on its own interval instead of a
  // metering-value-keyed effect.
  useEffect(() => {
    if (state !== 'recording') {
      hasSpokenRef.current = false;
      silenceStartRef.current = null;
      return;
    }
    const timer = setInterval(() => {
      const level = meteringRef.current;
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
    }, 200);
    return () => clearInterval(timer);
  }, [state, stopTurn]);

  // A reply finishing playback either closes out the conversation (the
  // user just asked to end) or hands the turn back for another listen.
  useEffect(() => {
    if (state !== 'speaking' || !playerStatus.didJustFinish) return;
    if (pendingEndRef.current) {
      pendingEndRef.current = false;
      setState('idle');
      endConversation().then((sessionId) => onAutoEnded?.(sessionId));
    } else {
      autoRestartRef.current = activeRef.current;
      setState('idle');
    }
  }, [state, playerStatus.didJustFinish, endConversation, onAutoEnded]);

  // Once idle actually commits (not just requested), auto-relisten if flagged.
  useEffect(() => {
    if (state === 'idle' && autoRestartRef.current) {
      autoRestartRef.current = false;
      startTurn();
    }
  }, [state, startTurn]);

  return {
    state,
    turns,
    startTurn,
    stopTurn,
    endConversation,
    cancelConversation,
  };
}
