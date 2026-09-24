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
 * heuristic tuned for "a normal pause after finishing a sentence," and may
 * need the *_MARGIN_DB constants adjusted after real-device testing (too
 * eager: cuts off mid-thought; too lax: never fires in a noisy room). How
 * long the pause has to last is the caller-supplied `silenceGapMs` (see
 * below) -- user-configurable in Settings -> AI, since "a normal pause"
 * varies by person/language. Tapping the button always still ends the turn
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
import { SPEECH_RECORDING_OPTIONS, waitForRecorderUri } from '@/hooks/useCaptureSession';
import { DIRECT_AUDIO_MAX_BYTES, DIRECT_AUDIO_UPLOAD_ENABLED } from '@/lib/featureFlags';
import { friendlyMessage } from '@/lib/friendlyError';
import { functionErrorCode, isNetworkError } from '@/lib/functionsError';
import { newTurnId, startPerfTurn, type PerfTurn } from '@/lib/perfLog';
import { withSystemDialog } from '@/lib/systemDialogGuard';
import { useAuth } from '@/providers/AuthProvider';
import { converseTurn, type ConverseAction, type ConverseResult } from '@/services/conversation';
import { processSession } from '@/services/processing';
import { localRecordingSize, uploadRecording } from '@/services/recordings';
import { createSession, deleteSession, endSession } from '@/services/sessions';

/** `actions` (assistant turns only): what the AI actually did in the app that turn, shown as confirmation chips. */
export type ConversationTurn = { role: 'user' | 'assistant'; content: string; actions?: ConverseAction[] };
export type ConversationState = 'idle' | 'recording' | 'thinking' | 'speaking';

// Metering is in dBFS (0 = loudest, more negative = quieter). On Android
// expo-audio derives it from MediaRecorder.getMaxAmplitude() -- the PEAK
// over the last poll window, not an average -- so ordinary room noise
// routinely peaks well above a fixed -35dB line and a fixed threshold never
// sees "silence" at all. The detector is therefore relative: it tracks the
// quietest level it has seen as a noise floor and looks for a drop back
// toward that floor after speech, rather than for an absolute level.
//
// How long that pause has to last before a turn ends is user-configurable
// (Settings -> AI -> Pause before replying, profiles.silence_gap_ms) --
// this is only the fallback for a signed-out/still-loading profile.
export const DEFAULT_SILENCE_DURATION_MS = 1500;
// Absolute cap on one turn's recording, regardless of what the silence
// detector above sees -- a safety net for the case where metering itself
// misbehaves (see the interval below), not a normal way for a turn to end.
// 25s was too aggressive in practice: a genuinely long answer (a real
// back-and-forth, not just a quick reply) hit it and got cut off mid-
// sentence, with the AI replying to only the truncated recording -- see
// the "maxDuration"-triggered turn in a real conversation's perf log.
// 3 minutes is long enough that only a truly stuck silence detector should
// ever reach it.
const MAX_TURN_RECORDING_MS = 180_000;
// Louder than this is always speech, whatever the floor says -- but only in
// a quiet room (floor below QUIET_ROOM_FLOOR_DB). In a moving car, road and
// engine noise peaks cross it all the time, and each crossing used to reset
// the pause timer, so a turn never ended while driving.
const ABSOLUTE_SPEECH_DB = -20;
const QUIET_ROOM_FLOOR_DB = -45;
// Above floor + this = speech; below floor + SILENCE_MARGIN_DB = quiet;
// in between = ambiguous (neither resets nor advances the pause timer).
const SPEECH_MARGIN_DB = 12;
const SILENCE_MARGIN_DB = 6;
// Readings are judged on the median of the last few, not one by one --
// Android reports the PEAK of each 200ms window, so a single bump, click or
// turn-signal tick would otherwise read as speech.
const SMOOTHING_READINGS = 3;
// The user's own speaking level, learned while they talk: once known, only
// readings within this many dB of it count as speech (noise swings don't),
// and anything this far below it counts as a pause even when constant noise
// keeps the level well above the floor.
const SPEECH_BAND_DB = 10;
const SPEECH_DROP_DB = 14;
// The floor drifts upward this much per 200ms tick so it can recover if the
// room gets louder, but snaps down instantly to any quieter reading.
const FLOOR_RISE_DB_PER_TICK = 0.25;
// Android reports -160 when the recorder has no samples yet (amplitude 0);
// treat anything this low as "no signal": it counts as quiet but must not
// become the floor, or every later reading would look like speech.
const NO_SIGNAL_DB = -100;
const FLOOR_MIN_DB = -70;
// Played instead of the spoken reply when converse made a change in the app
// but couldn't synthesize the reply (the text is on screen) -- so a driver
// still hears that the turn went through before the mic reopens.
const CONFIRM_SOUND = require('../../assets/sounds/confirm.wav');
// If the sound never reports finishing (failed to load), move on anyway.
const CONFIRM_SOUND_FALLBACK_MS = 3000;
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

// Observed on-device: recorder.stop() can occasionally just never resolve
// or reject at all (a wedged native session), which used to leave the
// whole conversation stuck showing "Listening" with the Stop button doing
// nothing -- stopTurn's own try/catch only guards against stop() THROWING,
// not against it hanging forever. Racing it against a timeout guarantees
// the turn always moves on to "whatever got captured" instead.
const RECORDER_STOP_TIMEOUT_MS = 5000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(undefined);
        }
      }
    );
  });
}

class TurnAbortedError extends Error {
  constructor() {
    super('turn aborted');
    this.name = 'TurnAbortedError';
  }
}

/**
 * @param onAutoEnded called when the AI itself detected a spoken "end and
 *   save" -- after the closing reply finishes playing and the session is
 *   already saved/queued for processing.
 * @param silenceGapMs how long a pause in speech has to last before a turn
 *   auto-ends -- the caller's profile.silence_gap_ms; defaults to
 *   DEFAULT_SILENCE_DURATION_MS if omitted (e.g. profile not loaded yet).
 */
export function useConversationSession(
  onAutoEnded?: (sessionId: string | null) => void,
  silenceGapMs: number = DEFAULT_SILENCE_DURATION_MS
) {
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
  // See SPEECH_BAND_DB -- kept across turns (the same voice, the same mic).
  const speechLevelRef = useRef<number | null>(null);
  const recentLevelsRef = useRef<number[]>([]);
  // Diagnostics for the perf log line: how this turn's readings were judged,
  // so a real drive's log shows why a pause was (or wasn't) detected.
  const detectorStatsRef = useRef({ speech: 0, quiet: 0, unsure: 0 });
  const detectorSnapshot = (): Record<string, number | null> => {
    const round = (v: number | null) => (v === null ? null : Math.round(v));
    return {
      ...detectorStatsRef.current,
      floorDb: round(noiseFloorRef.current),
      voiceDb: round(speechLevelRef.current),
    };
  };
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
  // Latency instrumentation for the current turn (see src/lib/perfLog.ts) --
  // created when recording starts, marked through transcribe/reply/play,
  // and printed once the reply either starts playing or the turn errors.
  // Diagnostic only; never holds transcript/reply text, only stage names
  // and byte counts.
  const currentTurnRef = useRef<PerfTurn | null>(null);
  const firstPlayMarkedRef = useRef(false);
  const lastTurnMetaRef = useRef<{
    trigger: string;
    audioPath: 'direct' | 'storage';
    noVoice?: boolean;
    detector?: Record<string, number | null>;
  } | null>(null);
  // Bumped whenever a reply's life ends (it finished, or the conversation
  // was ended/cancelled/interrupted/left), so a pending confirm-sound
  // fallback timer (see CONFIRM_SOUND_FALLBACK_MS) can't act on it later.
  const replySeqRef = useRef(0);
  const replyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateReply = useCallback(() => {
    replySeqRef.current += 1;
    if (replyTimerRef.current !== null) {
      clearTimeout(replyTimerRef.current);
      replyTimerRef.current = null;
    }
  }, []);

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
    invalidateReply();
    activeRef.current = false;
    // A turn that is mid-upload/transcription is the user's LAST words --
    // let it finish writing to `messages` first, or process-session's
    // transcript (built from those rows) silently drops it.
    if (turnPromiseRef.current) {
      await turnPromiseRef.current.catch(() => undefined);
    }
    abortedRef.current = true;
    if (recorderState.isRecording) {
      await withTimeout(recorder.stop(), RECORDER_STOP_TIMEOUT_MS);
    }
    player.pause();

    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) {
      try {
        await endSession(sessionId);
      } catch (e) {
        Alert.alert('Could not finish saving', friendlyMessage(e, 'Please try again.'));
      }
      processSession(sessionId).catch((e) => {
        Alert.alert(
          'Could not process this recording',
          friendlyMessage(e, 'Please try again.')
        );
      });
    }
    return sessionId;
  }, [recorder, recorderState.isRecording, player, invalidateReply]);

  // The latest endConversation, for callers that outlive a render (the turn
  // in flight, the player's finish event) -- a captured copy would hold a
  // stale recorder state.
  const autoEndRef = useRef<() => void>(() => {});
  autoEndRef.current = () => {
    endConversation().then((sessionId) => onAutoEnded?.(sessionId));
  };

  /** Stops any in-flight turn/playback and discards the whole
   *  conversation -- no processing, the audio and any transcript captured
   *  so far are deleted. This is Cancel, not a quiet version of ending;
   *  use endConversation to actually keep what was said. */
  const cancelConversation = useCallback(async (): Promise<void> => {
    invalidateReply();
    activeRef.current = false;
    abortedRef.current = true; // an in-flight turn bails at its next await instead of playing a reply into a dead screen
    if (recorderState.isRecording) {
      await withTimeout(recorder.stop(), RECORDER_STOP_TIMEOUT_MS);
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
  }, [recorder, recorderState.isRecording, player, invalidateReply]);

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
      recentLevelsRef.current = [];
      detectorStatsRef.current = { speech: 0, quiet: 0, unsure: 0 };
      activeRef.current = true;
      abortedRef.current = false;
      hasContentRef.current = true;
      setInterruption(null);
      setState('recording');
      currentTurnRef.current = startPerfTurn('conversation');
      firstPlayMarkedRef.current = false;
    } catch (e) {
      Alert.alert('Could not start recording', friendlyMessage(e, 'Please try again.'));
    }
  }, [state, recorder, ensureSession]);

  const stopTurn = useCallback(
    async (trigger: 'manual' | 'silence' | 'maxDuration' = 'manual') => {
      if (state !== 'recording' || !user || stoppingRef.current) return;
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      stoppingRef.current = true;
      setTurnBusy(true);
      const perf = currentTurnRef.current;
      perf?.mark('stop_requested');
      // Sent with the request (and reused by its one retry) so converse can
      // recognize a retried turn and replay it instead of running any
      // app changes it made -- like adding a task -- a second time.
      const turnId = perf?.turnId ?? newTurnId();
      const throwIfAborted = () => {
        if (abortedRef.current) throw new TurnAbortedError();
      };

      // The reply came back but can't be voiced: its text (and chips) are on
      // screen already, so play the confirmation sound and carry on as if
      // the reply had just finished playing (listen again, or end).
      const finishWithoutVoice = (meta: { trigger: string; audioPath: 'direct' | 'storage' }) => {
        lastTurnMetaRef.current = { ...meta, noVoice: true, detector: detectorSnapshot() };
        stateRef.current = 'speaking';
        setState('speaking');
        invalidateReply();
        const seq = replySeqRef.current;
        replyTimerRef.current = setTimeout(() => {
          replyTimerRef.current = null;
          if (replySeqRef.current === seq) onReplyFinishedRef.current();
        }, CONFIRM_SOUND_FALLBACK_MS);
        try {
          player.replace(CONFIRM_SOUND);
          player.play();
        } catch {
          onReplyFinishedRef.current();
        }
      };

      // The user asked by voice to save and end, and the reply saying so is
      // on screen, but an interruption stopped the turn before it played.
      let endAfterAbort = false;

      const run = async () => {
        let audioPath: 'direct' | 'storage' = 'storage';
        let audioBytes: number | undefined;
        // Once the server has answered, the turn happened -- including any
        // change the AI made -- whatever goes wrong locally afterwards.
        let answered = false;
        let endRequested = false;
        try {
          const elapsed = Date.now() - (recordingStartedAtRef.current ?? 0);
          if (elapsed < MIN_RECORDING_MS) {
            await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS - elapsed));
          }

          // withTimeout also covers the native recorder throwing on stop
          // (e.g. it was already winding down on its own) -- either way,
          // press on and try to use whatever got captured rather than
          // leaving the turn stuck on "Listening…" forever.
          await withTimeout(recorder.stop(), RECORDER_STOP_TIMEOUT_MS);
          throwIfAborted();
          setState('thinking');
          perf?.mark('recorder_stopped');

          // recorder.uri is a native SharedObject property, not plain JS state
          // -- reading it the instant stop() resolves occasionally still saw
          // a stale/null value rather than the file that had just been
          // written, throwing "No audio was captured" for a turn that really
          // did record something. See waitForRecorderUri's own comment.
          const uri = await waitForRecorderUri(recorder);
          if (!uri) throw new Error('No audio was captured for that turn.');
          throwIfAborted();
          perf?.mark('file_ready');

          // Send the segment directly in the request when it's small enough
          // (the common case -- these are single back-and-forth turns, not
          // Capture's long-form recordings) instead of uploading it to
          // Storage first and passing just the path -- see
          // src/lib/featureFlags.ts for the size threshold and how to back
          // this out. converse still keeps a backup copy in Storage itself
          // on this path (written in parallel with transcribing, not
          // blocking it) -- see converse/index.ts.
          let result: ConverseResult | undefined;
          if (DIRECT_AUDIO_UPLOAD_ENABLED) {
            const byteLength = localRecordingSize(uri);
            audioBytes = byteLength;
            if (byteLength > 0 && byteLength <= DIRECT_AUDIO_MAX_BYTES) {
              throwIfAborted();
              perf?.mark('audio_read');
              audioPath = 'direct';
              result = await withOneRetry(() =>
                converseTurn(sessionId, { uri, mimeType: 'audio/m4a' }, turnId)
              );
            }
          }
          if (!result) {
            const attachment = await uploadRecording(user.id, sessionId, uri);
            throwIfAborted();
            perf?.mark('uploaded');
            audioPath = 'storage';
            // The audio is already safely uploaded by this point -- retrying
            // just the transcribe+reply call costs nothing extra on a
            // transient network hiccup instead of losing the turn outright.
            result = await withOneRetry(() =>
              converseTurn(sessionId, { storagePath: attachment.storage_path }, turnId)
            );
          }
          answered = true;
          endRequested = result.shouldEnd;
          perf?.mark('function_call_done');

          // Shown even if the turn was interrupted meanwhile (a call came in,
          // the app went to the background) -- the reply may confirm a change
          // the AI already made. Not after Cancel or leaving the screen,
          // though: that conversation is gone.
          const answer = result;
          if (sessionIdRef.current === sessionId) {
            setTurns((prev) => {
              const next = [...prev];
              if (answer.userText) next.push({ role: 'user', content: answer.userText });
              next.push({
                role: 'assistant',
                content: answer.assistantText,
                actions: answer.actions?.length ? answer.actions : undefined,
              });
              return next;
            });
          }
          throwIfAborted();
          pendingEndRef.current = result.shouldEnd;

          if (!result.audioBase64) {
            finishWithoutVoice({ trigger, audioPath });
            return;
          }

          const replyFile = new File(Paths.cache, `mind-record-reply-${Date.now()}.mp3`);
          replyFile.write(result.audioBase64, { encoding: 'base64' });
          perf?.mark('reply_file_written');
          player.replace(replyFile.uri);
          player.play();
          perf?.mark('play_called');
          lastTurnMetaRef.current = { trigger, audioPath, detector: detectorSnapshot() };
          setState('speaking');
        } catch (e) {
          if (e instanceof TurnAbortedError) {
            // An interruption aborts a 'thinking' turn without touching state
            // itself (see useAudioInterruption below) -- land it in idle here.
            if (stateRef.current === 'thinking') setState('idle');
            // Not after Cancel or leaving the screen: those cleared the
            // session and deal with it themselves.
            if (answered && endRequested && sessionIdRef.current === sessionId) endAfterAbort = true;
            perf?.finish({ trigger, audioPath, aborted: true, answered });
            currentTurnRef.current = null;
            return;
          }
          if (answered) {
            // Only playing the reply failed (e.g. writing the audio file) --
            // it's on screen, and it was saved server-side.
            console.warn('conversation reply playback failed:', e instanceof Error ? e.message : String(e));
            finishWithoutVoice({ trigger, audioPath });
            return;
          }
          // 'turn_busy': a retry found this turn still running elsewhere --
          // it may well have gone through, so don't suggest it was lost.
          Alert.alert(
            'Could not process that',
            functionErrorCode(e) === 'turn_busy'
              ? friendlyMessage(e, 'Please check before trying again.')
              : friendlyMessage(e, 'Please try again.') + ' What you just said may not have been saved.'
          );
          setState('idle');
          // The raw error (not the user-facing friendlyMessage) so a
          // real-device failure is diagnosable straight from this one log
          // line, without needing the on-screen alert text or dashboard
          // digging -- see the byte size too, since a request that never
          // reaches converse's own logging (no matching turnId server-side)
          // most likely means it was rejected before Supabase's gateway
          // ever logged it, e.g. a body-size limit.
          perf?.finish({
            trigger,
            audioPath,
            audioBytes,
            error: true,
            errorMessage: e instanceof Error ? e.message : String(e),
            errorName: e instanceof Error ? e.name : undefined,
          });
          currentTurnRef.current = null;
        } finally {
          stoppingRef.current = false;
          setTurnBusy(false);
        }
      };
      const promise = run();
      turnPromiseRef.current = promise;
      await promise;
      if (turnPromiseRef.current === promise) turnPromiseRef.current = null;
      // Only now: endConversation waits for the in-flight turn, i.e. this one.
      if (endAfterAbort) autoEndRef.current();
    },
    [state, user, recorder, player, invalidateReply]
  );

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
      // A hard ceiling independent of the metering-based silence detector
      // above: if metering itself never reports a reading (or never reads
      // as "speech" -- observed on-device as a turn stuck on "Listening"
      // with no way out, since the silence timer never even starts without
      // hasSpokenRef first flipping true), the turn still ends instead of
      // waiting forever.
      const recordingElapsed = Date.now() - (recordingStartedAtRef.current ?? Date.now());
      if (recordingElapsed >= MAX_TURN_RECORDING_MS) {
        stopTurn('maxDuration');
        return;
      }

      const raw = meteringRef.current;
      if (raw === undefined) return;

      let quiet: boolean;
      let speech = false;
      if (raw <= NO_SIGNAL_DB) {
        quiet = true;
      } else {
        const recent = recentLevelsRef.current;
        recent.push(raw);
        if (recent.length > SMOOTHING_READINGS) recent.shift();
        const level = [...recent].sort((a, b) => a - b)[Math.floor(recent.length / 2)];

        const prev = noiseFloorRef.current;
        const floor = Math.max(
          FLOOR_MIN_DB,
          prev === null ? level : Math.min(level, prev + FLOOR_RISE_DB_PER_TICK)
        );
        noiseFloorRef.current = floor;
        const voice = speechLevelRef.current;

        const aboveNoise = level > floor + SPEECH_MARGIN_DB && (voice === null || level > voice - SPEECH_BAND_DB);
        const loudInQuietRoom = floor < QUIET_ROOM_FLOOR_DB && level > ABSOLUTE_SPEECH_DB;
        speech = aboveNoise || loudInQuietRoom;
        quiet = level < Math.max(floor + SILENCE_MARGIN_DB, voice === null ? -Infinity : voice - SPEECH_DROP_DB);
        if (speech) speechLevelRef.current = voice === null ? level : voice * 0.8 + level * 0.2;
      }
      const stats = detectorStatsRef.current;
      if (speech) stats.speech++;
      else if (quiet) stats.quiet++;
      else stats.unsure++;

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
      if (Date.now() - silenceStartRef.current >= silenceGapMs) {
        stopTurn('silence');
      }
    }, 200);
    return () => clearInterval(timer);
  }, [state, stopTurn, silenceGapMs]);

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
    // Already ended or cancelled (a finish event queued before Save & end).
    if (sessionIdRef.current === null) return;
    stateRef.current = 'idle';
    invalidateReply();
    const turn = currentTurnRef.current;
    turn?.mark('reply_finished');
    turn?.finish({
      ...lastTurnMetaRef.current,
      // The headline number this whole effort is about -- see the file
      // header for why "first_native_playing" is a proxy, not a verified
      // "audible to a human" timestamp.
      stopRequestedToFirstAudioMs: turn.msFrom('stop_requested', 'first_native_playing'),
    });
    currentTurnRef.current = null;
    if (pendingEndRef.current) {
      pendingEndRef.current = false;
      setState('idle');
      autoEndRef.current();
    } else {
      autoRestartRef.current = activeRef.current;
      setState('idle');
    }
  };
  useEffect(() => {
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      // The headline number this instrumentation exists for: the first
      // native "now playing" event after play() was called this turn --
      // NOT verified to be the first moment sound is actually audible
      // (see src/lib/perfLog.ts's own caveat on this).
      if (status.playing && !firstPlayMarkedRef.current && stateRef.current === 'speaking') {
        firstPlayMarkedRef.current = true;
        currentTurnRef.current?.mark('first_native_playing');
      }
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
    invalidateReply();
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
      invalidateReply();
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
        if (recorder.isRecording) {
          await withTimeout(recorder.stop(), RECORDER_STOP_TIMEOUT_MS);
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
    [recorder, player, invalidateReply]
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
