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
 * may need the *_MARGIN_DB/SILENCE_DURATION_MS constants adjusted after
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
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAudioInterruption, type InterruptionReason } from '@/hooks/useAudioInterruption';
import { SPEECH_RECORDING_OPTIONS } from '@/hooks/useCaptureSession';
import { isNetworkError } from '@/lib/functionsError';
import { withSystemDialog } from '@/lib/systemDialogGuard';
import { useAuth } from '@/providers/AuthProvider';
import { converseTurn } from '@/services/conversation';
import { processSession } from '@/services/processing';
import { uploadRecording } from '@/services/recordings';
import { createSession, deleteSession, endSession } from '@/services/sessions';

export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type ConversationState = 'idle' | 'recording' | 'thinking' | 'speaking';

// Metering is in dBFS (0 = loudest, more negative = quieter). On Android
// expo-audio derives it from MediaRecorder.getMaxAmplitude() -- the PEAK
// over the last poll window, not an average -- so ordinary room noise
// routinely peaks well above a fixed -35dB line and a fixed threshold never
// sees "silence" at all. The detector is therefore relative: it tracks the
// quietest level it has seen as a noise floor and looks for a drop back
// toward that floor after speech, rather than for an absolute level.
const SILENCE_DURATION_MS = 1500;
// Louder than this is always speech, whatever the floor says.
const ABSOLUTE_SPEECH_DB = -20;
// Above floor + this = speech; below floor + SILENCE_MARGIN_DB = quiet;
// in between = ambiguous (neither resets nor advances the pause timer).
const SPEECH_MARGIN_DB = 12;
const SILENCE_MARGIN_DB = 6;
// The floor drifts upward this much per 200ms tick so it can recover if the
// room gets louder, but snaps down instantly to any quieter reading.
const FLOOR_RISE_DB_PER_TICK = 0.25;
// Android reports -160 when the recorder has no samples yet (amplitude 0);
// treat anything this low as "no signal": it counts as quiet but must not
// become the floor, or every later reading would look like speech.
const NO_SIGNAL_DB = -100;
const FLOOR_MIN_DB = -70;
// Stopping the native recorder within roughly the first second of starting
// it can throw and/or leave a corrupt, zero-duration file behind (a known
// Android MediaRecorder quirk) -- always pad a stop out to at least this long.
const MIN_RECORDING_MS = 800;

// Only a request that never reached the function is retried: a 4xx/5xx
// that did reach it may already have inserted this turn's messages, and
// re-sending would duplicate them in the transcript.
async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return await fn();
  }
}

class TurnAbortedError extends Error {
  constructor() {
    super('turn aborted');
    this.name = 'TurnAbortedError';
  }
}

/** @param onAutoEnded called when the AI itself detected a spoken "end and save" -- after the closing reply finishes playing and the session is already saved/queued for processing. */
export function useConversationSession(onAutoEnded?: (sessionId: string | null) => void) {
  const { user } = useAuth();
  const [state, setState] = useState<ConversationState>('idle');
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  // True from the moment a stop is requested until the turn's reply is
  // playing (or it failed) -- covers the window where `state` still says
  // 'recording' but the recorder is already being padded/stopped/uploaded.
  const [turnBusy, setTurnBusy] = useState(false);
  // Why the loop stopped when it wasn't the user who stopped it -- cleared
  // the next time a turn starts.
  const [interruption, setInterruption] = useState<InterruptionReason | null>(null);
  const stateRef = useRef<ConversationState>('idle');
  stateRef.current = state;
  const sessionIdRef = useRef<string | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const noiseFloorRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  // Guards stopTurn against overlapping calls -- the silence interval below
  // ticks every 200ms independent of how far a previous stopTurn() call has
  // gotten, and `state` itself doesn't update until well after that call
  // starts, so the `state !== 'recording'` check alone can't tell "already
  // stopping" from "not yet stopped".
  const stoppingRef = useRef(false);
  // The in-flight stopTurn() promise, so ending the conversation can wait
  // for the last turn's transcript to land in `messages` before
  // process-session reads them -- and cancelling can abort it instead.
  const turnPromiseRef = useRef<Promise<void> | null>(null);
  const abortedRef = useRef(false);
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
  // True once this session actually has something worth keeping (recording
  // has started at least once) -- lets the unmount cleanup below tell "the
  // user left before saying anything" (safe to delete) from "the user left
  // mid-conversation without tapping Save & end or Cancel" (must NOT be
  // silently discarded).
  const hasContentRef = useRef(false);

  // Metering has to be switched on HERE, in the construction-time options,
  // not passed to prepareToRecordAsync() later: expo-audio's
  // createRecordingOptions() rebuilds the whole native config from whatever
  // object it's handed, so calling prepareToRecordAsync({ isMeteringEnabled })
  // silently dropped the preset's extension/sampleRate/encoder -- the
  // recorder then wrote an unencoded, zero-duration file (Whisper: "Invalid
  // file format", duration 0) and never reported a metering level, which is
  // why the silence auto-stop never fired either.
  const recorder = useAudioRecorder({ ...SPEECH_RECORDING_OPTIONS, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 200);
  meteringRef.current = recorderState.metering;
  const player = useAudioPlayer(null);

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
    // A turn that is mid-upload/transcription is the user's LAST words --
    // let it finish writing to `messages` first, or process-session's
    // transcript (built from those rows) silently drops it.
    if (turnPromiseRef.current) {
      await turnPromiseRef.current.catch(() => undefined);
    }
    abortedRef.current = true;
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
    abortedRef.current = true; // an in-flight turn bails at its next await instead of playing a reply into a dead screen
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
    hasContentRef.current = false;
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
    // Wrapped so the OS permission dialog's own brief AppState blip doesn't
    // get read by the biometric lock gate as a real app-leave.
    const permission = await withSystemDialog(() => requestRecordingPermissionsAsync());
    if (!permission.granted) {
      Alert.alert(
        'Microphone access needed',
        'Mind Record needs microphone access to talk with you. You can enable it in Settings.'
      );
      return;
    }
    try {
      await ensureSession();
      // Explicitly off: the audio mode is app-global and Capture may have
      // turned it on earlier in this run. A conversation can't usefully
      // continue in the background (the reply has to be heard), so it
      // stops on backgrounding instead -- see useAudioInterruption below.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: false });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingStartedAtRef.current = Date.now();
      activeRef.current = true;
      abortedRef.current = false;
      hasContentRef.current = true;
      setInterruption(null);
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
    setTurnBusy(true);
    const throwIfAborted = () => {
      if (abortedRef.current) throw new TurnAbortedError();
    };

    const run = async () => {
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
        throwIfAborted();
        setState('thinking');

        const uri = recorder.uri;
        if (!uri) throw new Error('No audio was captured for that turn.');
        const attachment = await uploadRecording(user.id, sessionId, uri);
        throwIfAborted();
        // The audio is already safely uploaded by this point -- retrying
        // just the transcribe+reply call costs nothing extra on a transient
        // network hiccup instead of losing the turn outright.
        const result = await withOneRetry(() => converseTurn(sessionId, attachment.storage_path));
        throwIfAborted();

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
        if (e instanceof TurnAbortedError) {
          // An interruption aborts a 'thinking' turn without touching state
          // itself (see useAudioInterruption below) -- land it in idle here.
          if (stateRef.current === 'thinking') setState('idle');
          return;
        }
        Alert.alert(
          'Could not process that',
          (e instanceof Error ? e.message : 'Please try again.') +
            ' What you just said may not have been saved.'
        );
        setState('idle');
      } finally {
        stoppingRef.current = false;
        setTurnBusy(false);
      }
    };
    const promise = run();
    turnPromiseRef.current = promise;
    await promise;
    if (turnPromiseRef.current === promise) turnPromiseRef.current = null;
  }, [state, user, recorder, player]);

  // Auto-ends the turn after a pause in speech, so the user doesn't have
  // to tap the button every time -- see the file header for the caveats,
  // and for why this runs on its own interval instead of a
  // metering-value-keyed effect.
  useEffect(() => {
    if (state !== 'recording') {
      hasSpokenRef.current = false;
      silenceStartRef.current = null;
      // noiseFloorRef is deliberately kept across turns: the room doesn't
      // change between one reply and the next, and re-seeding it from the
      // first reading of a turn the user is already talking into would put
      // the "floor" at speech level and miss that whole utterance.
      return;
    }
    const timer = setInterval(() => {
      const level = meteringRef.current;
      if (level === undefined) return;

      let quiet: boolean;
      let speech = false;
      if (level <= NO_SIGNAL_DB) {
        quiet = true;
      } else {
        const prev = noiseFloorRef.current;
        const floor = Math.max(
          FLOOR_MIN_DB,
          prev === null ? level : Math.min(level, prev + FLOOR_RISE_DB_PER_TICK)
        );
        noiseFloorRef.current = floor;
        speech = level > ABSOLUTE_SPEECH_DB || level > floor + SPEECH_MARGIN_DB;
        quiet = level < floor + SILENCE_MARGIN_DB;
      }

      if (speech) {
        hasSpokenRef.current = true;
        silenceStartRef.current = null;
        return;
      }
      if (!hasSpokenRef.current) return; // hasn't started talking yet -- don't count this as a pause
      if (!quiet) return; // ambiguous band -- leave the pause timer where it is
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
  //
  // This listens to the player's native status events directly rather than
  // reading useAudioPlayerStatus().didJustFinish: that hook just retains
  // the last event, and the native side sends didJustFinish:true exactly
  // once and then nothing more (no status updates while stopped), so the
  // retained value stayed `true` through the whole next turn. The next
  // reply's play() then looked "already finished" the instant `state`
  // became 'speaking' -- the loop re-opened the mic over the AI's own
  // voice, or cut the closing reply short when ending.
  const onReplyFinishedRef = useRef<() => void>(() => {});
  onReplyFinishedRef.current = () => {
    if (stateRef.current !== 'speaking') return;
    if (pendingEndRef.current) {
      pendingEndRef.current = false;
      setState('idle');
      endConversation().then((sessionId) => onAutoEnded?.(sessionId));
    } else {
      autoRestartRef.current = activeRef.current;
      setState('idle');
    }
  };
  useEffect(() => {
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) onReplyFinishedRef.current();
    });
    return () => subscription.remove();
  }, [player]);

  // Losing the mic or the foreground mid-loop: stop the hands-free loop
  // and go idle, keeping the session so the user can pick it back up with
  // one tap. A half-recorded turn is discarded rather than sent -- a
  // sentence cut off by a phone call would only produce a confused reply
  // -- and a reply that was playing is simply stopped (the OS has paused
  // the player anyway; it would otherwise sit in 'speaking' forever,
  // because a paused player never reports didJustFinish).
  useAudioInterruption(recorder, (reason) => {
    const current = stateRef.current;
    if (current === 'idle') return;
    setInterruption(reason);
    activeRef.current = false;
    autoRestartRef.current = false;
    if (current === 'recording' || current === 'thinking') {
      abortedRef.current = true;
      if (recorder.isRecording) {
        recorder.stop().catch(() => {
          // Best-effort -- the recorder may already be gone.
        });
      }
    }
    player.pause();
    if (current !== 'thinking') setState('idle');
  });

  // Leaving the screen mid-conversation (Android back, swipe) must NOT
  // silently destroy what was already said -- only a session that never
  // actually started recording (nothing to lose) is safe to delete here.
  // Anything with real content is instead saved exactly like tapping
  // "Save & end": the in-flight (not-yet-uploaded) utterance, if any, can
  // still be lost since there's no way to run the full upload/transcribe
  // pipeline from an unmount cleanup, but every turn already confirmed
  // into `messages` is preserved instead of being deleted outright.
  useEffect(
    () => () => {
      abortedRef.current = true;
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
          if (recorder.isRecording) await recorder.stop();
        } catch {
          // Best-effort -- saving the session either way.
        }
        player.pause();
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
    [recorder, player]
  );

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
    turnBusy,
    interruption,
    startTurn,
    stopTurn,
    endConversation,
    cancelConversation,
  };
}
