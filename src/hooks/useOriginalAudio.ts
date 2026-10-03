/**
 * Plays a record's original recording (all of its audio segments, in
 * order) on the Summary screen, streamed from Storage through short-lived
 * signed links. Keeps playing if the user switches apps (like Read aloud);
 * stops when they leave the screen. Playback only.
 */
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { friendlyMessage } from '@/lib/friendlyError';
import { audioPlaybackUrls, deleteSessionAudio, listSessionAudio, type Attachment } from '@/services/recordings';

export type OriginalAudioState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export function useOriginalAudio(sessionId: string | undefined) {
  const player = useAudioPlayer(null);
  const [segments, setSegments] = useState<Attachment[] | null>(null);
  const [state, setState] = useState<OriginalAudioState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [part, setPart] = useState(0);
  const stateRef = useRef<OriginalAudioState>('idle');
  stateRef.current = state;
  const urlsRef = useRef<string[]>([]);
  const partRef = useRef(0);
  const runRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    try {
      setSegments(await listSessionAudio(sessionId));
    } catch {
      setSegments([]);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const playPart = useCallback(
    (index: number) => {
      partRef.current = index;
      setPart(index);
      player.replace({ uri: urlsRef.current[index] });
      player.play();
      setState('playing');
    },
    [player]
  );

  const start = useCallback(async () => {
    if (!segments || segments.length === 0) return;
    const run = ++runRef.current;
    setError(null);
    setState('loading');
    try {
      urlsRef.current = await audioPlaybackUrls(segments.map((s) => s.storage_path));
      if (run !== runRef.current) return;
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      }).catch(() => {});
      if (run !== runRef.current) return;
      playPart(0);
    } catch (e) {
      if (run !== runRef.current) return;
      setError(friendlyMessage(e, 'Could not play the original recording.'));
      setState('error');
    }
  }, [segments, playPart]);

  const stop = useCallback(() => {
    runRef.current++;
    try {
      player.pause();
    } catch {
      // Already released.
    }
    setState('idle');
    setError(null);
  }, [player]);

  const pause = useCallback(() => {
    if (stateRef.current !== 'playing') return;
    player.pause();
    setState('paused');
  }, [player]);

  const resume = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    player.play();
    setState('playing');
  }, [player]);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish || stateRef.current !== 'playing') return;
      const next = partRef.current + 1;
      if (next < urlsRef.current.length) playPart(next);
      else setState('idle');
    });
    return () => sub.remove();
  }, [player, playPart]);

  useEffect(
    () => () => {
      runRef.current++;
      try {
        player.pause();
      } catch {
        // Released with the screen.
      }
    },
    [player]
  );

  const remove = useCallback(async () => {
    if (!sessionId) return;
    stop();
    await deleteSessionAudio(sessionId);
    setSegments([]);
  }, [sessionId, stop]);

  const totalSeconds = (segments ?? []).reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0);

  return {
    /** null while loading; [] when there's no original (deleted, a typed note, or kept only as a transcript). */
    segments,
    totalSeconds,
    state,
    error,
    part,
    start,
    stop,
    pause,
    resume,
    remove,
    refresh,
  };
}
