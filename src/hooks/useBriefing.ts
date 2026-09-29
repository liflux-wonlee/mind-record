/**
 * "Listen" -- today's reminders read out in the user's AI voice (the
 * reminder-briefing Edge Function builds the text from the same agenda as
 * Home and the Reminders list, and synthesizes it with the existing TTS).
 *
 * Playback only: this never records or turns on the microphone. Answering
 * ("the second one is done") is a separate, explicit step -- the caller
 * offers a "Reply by voice" button that opens the normal voice conversation.
 *
 * Same interruption policy as the app's other AI audio (see
 * useAudioInterruption.ts): stops the moment the app goes to the
 * background, on unmount, and shows Paused when the OS takes audio away
 * (a call, another app). When there's no audio (TTS failed, usage limit,
 * offline part-way) the script and items are still shown as text.
 */
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { friendlyMessage } from '@/lib/friendlyError';
import { getBriefing, type Briefing } from '@/services/reminders';

export type BriefingState = 'idle' | 'loading' | 'playing' | 'paused' | 'done' | 'error';

export function useBriefing(onFinished?: () => void) {
  const player = useAudioPlayer(null);
  const [state, setState] = useState<BriefingState>('idle');
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<BriefingState>('idle');
  stateRef.current = state;
  // Whether native playback actually started -- before that `playing: false`
  // is just buffering, not an interruption.
  const startedRef = useRef(false);
  const userPausedRef = useRef(false);
  const requestIdRef = useRef(0);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const fileRef = useRef<File | null>(null);
  const briefingRef = useRef<Briefing | null>(null);
  briefingRef.current = briefing;

  const cleanupFile = () => {
    try {
      fileRef.current?.delete();
    } catch {
      // Cache file already gone.
    }
    fileRef.current = null;
  };

  const stop = useCallback(() => {
    requestIdRef.current++;
    try {
      player.pause();
    } catch {
      // Player already released.
    }
    startedRef.current = false;
    if (stateRef.current === 'playing' || stateRef.current === 'paused' || stateRef.current === 'loading') {
      setState(briefingRef.current ? 'done' : 'idle');
      onFinishedRef.current?.();
    }
  }, [player]);

  const start = useCallback(async () => {
    if (stateRef.current === 'loading') return;
    const requestId = ++requestIdRef.current;
    try {
      player.pause();
    } catch {
      // nothing playing
    }
    startedRef.current = false;
    userPausedRef.current = false;
    setError(null);
    setState('loading');
    try {
      const result = await getBriefing();
      if (requestId !== requestIdRef.current) return;
      setBriefing(result);
      if (!result.audioBase64 || AppState.currentState !== 'active') {
        setState('done');
        return;
      }
      cleanupFile();
      const file = new File(Paths.cache, `briefing-${Date.now()}.mp3`);
      file.write(result.audioBase64, { encoding: 'base64' });
      fileRef.current = file;
      // Playback only -- no recording session.
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false, shouldPlayInBackground: false });
      if (requestId !== requestIdRef.current) return;
      player.replace(file.uri);
      player.play();
      setState('playing');
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(friendlyMessage(e, 'Could not prepare the briefing.'));
      setState('error');
    }
  }, [player]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'playing') return;
    userPausedRef.current = true;
    player.pause();
    setState('paused');
  }, [player]);

  const resume = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    userPausedRef.current = false;
    player.play();
    setState('playing');
  }, [player]);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (status.playing) startedRef.current = true;
      if (status.didJustFinish && stateRef.current === 'playing') {
        startedRef.current = false;
        setState('done');
        onFinishedRef.current?.();
        return;
      }
      // The OS paused us (a call, another app's audio, headphones unplugged).
      if (
        stateRef.current === 'playing' &&
        startedRef.current &&
        !status.playing &&
        !status.didJustFinish &&
        !userPausedRef.current
      ) {
        setState('paused');
      }
    });
    return () => sub.remove();
  }, [player]);

  // Never keep talking in the background (lock screen, app switch, call).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') stop();
    });
    return () => sub.remove();
  }, [stop]);

  // Leaving the screen stops it too.
  useEffect(
    () => () => {
      requestIdRef.current++;
      try {
        player.pause();
      } catch {
        // Already released with the component.
      }
      cleanupFile();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [player]
  );

  const reset = useCallback(() => {
    stop();
    setBriefing(null);
    setError(null);
    setState('idle');
  }, [stop]);

  return { state, briefing, error, start, pause, resume, stop, reset };
}
