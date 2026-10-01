/**
 * "Read aloud" for a record's Summary tab -- the title, summary, outline,
 * tasks and ideas spoken in the user's AI voice so they can be heard
 * without looking at the screen (e.g. while driving).
 *
 * The server (supabase/functions/read-aloud) splits a long record into
 * parts; this plays them in order and fetches the next part while the
 * current one plays. Fetched parts are kept for the life of the screen, so
 * "play again" costs nothing -- until the content changes (an edit), which
 * drops them.
 *
 * Unlike the AI conversation audio, this keeps playing when the user
 * switches to another app (e.g. navigation) -- that's the point of it -- and
 * it ducks other audio rather than mixing with it. While it plays the
 * screen is kept awake. It stops when the user leaves the screen.
 * Playback only: the microphone is never touched.
 */
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';

import { friendlyMessage } from '@/lib/friendlyError';
import { getReadAloudPart } from '@/services/readAloud';

export type ReadAloudState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

const KEEP_AWAKE_TAG = 'read-aloud';

type Fetched = { file: File; count: number };

export function useReadAloud(sessionId: string | undefined, contentKey: string) {
  const player = useAudioPlayer(null);
  const [state, setState] = useState<ReadAloudState>('idle');
  const [progress, setProgress] = useState<{ part: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<ReadAloudState>('idle');
  stateRef.current = state;
  // Bumped by every start/stop -- a stale async step checks it and bails.
  const runRef = useRef(0);
  // Whether the current part actually started -- before that `playing:
  // false` is just buffering, not an interruption.
  const startedRef = useRef(false);
  const userPausedRef = useRef(false);
  const partRef = useRef(0);
  const countRef = useRef(1);
  const cacheRef = useRef(new Map<number, Promise<Fetched>>());
  const readyRef = useRef(new Set<number>());
  const filesRef = useRef<File[]>([]);

  const clearCache = useCallback(() => {
    for (const file of filesRef.current) {
      try {
        file.delete();
      } catch {
        // Cache file already gone.
      }
    }
    filesRef.current = [];
    cacheRef.current = new Map();
    readyRef.current = new Set();
  }, []);

  const fetchPart = useCallback(
    (index: number): Promise<Fetched> => {
      const cached = cacheRef.current.get(index);
      if (cached) return cached;
      if (!sessionId) return Promise.reject(new Error('Nothing to read.'));
      const cache = cacheRef.current;
      const promise = getReadAloudPart(sessionId, index).then((res) => {
        const file = new File(Paths.cache, `read-aloud-${Date.now()}-${index}.mp3`);
        file.write(res.audioBase64, { encoding: 'base64' });
        filesRef.current.push(file);
        if (cache === cacheRef.current) readyRef.current.add(index);
        return { file, count: res.partCount };
      });
      cache.set(index, promise);
      // A failed part is fetched again on the next try.
      promise.catch(() => {
        if (cache.get(index) === promise) cache.delete(index);
      });
      return promise;
    },
    [sessionId]
  );

  const playPart = useCallback(
    async (index: number, run: number) => {
      partRef.current = index;
      startedRef.current = false;
      if (!readyRef.current.has(index)) setState('loading');
      try {
        const { file, count } = await fetchPart(index);
        if (run !== runRef.current) return;
        countRef.current = count;
        setProgress({ part: index, count });
        userPausedRef.current = false;
        player.replace(file.uri);
        player.play();
        setState('playing');
        if (index + 1 < count) {
          fetchPart(index + 1).catch(() => {
            // Retried when that part's turn comes.
          });
        }
      } catch (e) {
        if (run !== runRef.current) return;
        setError(friendlyMessage(e, 'Could not read this record aloud.'));
        setState('error');
      }
    },
    [fetchPart, player]
  );

  const start = useCallback(async () => {
    const run = ++runRef.current;
    try {
      player.pause();
    } catch {
      // nothing playing
    }
    setError(null);
    setState('loading');
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      });
    } catch {
      // Plays with the current mode.
    }
    if (run !== runRef.current) return;
    await playPart(0, run);
  }, [playPart, player]);

  /** After an error: carries on from the part that failed. */
  const retry = useCallback(async () => {
    const run = ++runRef.current;
    setError(null);
    await playPart(partRef.current, run);
  }, [playPart]);

  const stop = useCallback(() => {
    runRef.current++;
    try {
      player.pause();
    } catch {
      // Player already released.
    }
    startedRef.current = false;
    setProgress(null);
    setError(null);
    setState('idle');
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
      if (status.didJustFinish) {
        if (stateRef.current !== 'playing') return;
        startedRef.current = false;
        const next = partRef.current + 1;
        if (next < countRef.current) {
          playPart(next, runRef.current);
        } else {
          setProgress(null);
          setState('idle');
        }
        return;
      }
      if (status.playing) startedRef.current = true;
      // The OS paused us (a call, headphones unplugged).
      if (stateRef.current === 'playing' && startedRef.current && !status.playing && !userPausedRef.current) {
        setState('paused');
      }
    });
    return () => sub.remove();
  }, [player, playPart]);

  // An edited summary/outline reads differently -- drop what was fetched.
  useEffect(() => {
    stop();
    clearCache();
  }, [sessionId, contentKey, stop, clearCache]);

  // Keep the screen on while reading (a car mount, hands on the wheel).
  useEffect(() => {
    if (state === 'loading' || state === 'playing' || state === 'paused') {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {
        // Best-effort -- worst case the screen times out as usual.
      });
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {
        // Not held -- nothing to release.
      });
    }
  }, [state]);

  // Leaving the screen stops it.
  useEffect(
    () => () => {
      runRef.current++;
      try {
        player.pause();
      } catch {
        // Already released with the component.
      }
      clearCache();
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {
        // Not held -- nothing to release.
      });
    },
    [player, clearCache]
  );

  return { state, progress, error, start, retry, stop, pause, resume };
}
