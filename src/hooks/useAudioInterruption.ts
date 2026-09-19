/**
 * Tells a recording session when the outside world took the microphone
 * away, so it can pause/abort deterministically instead of carrying on
 * with a recorder that is silently no longer capturing anything.
 *
 * Two signals are wired up:
 *  - the app leaving the foreground (screen lock, app switch, an answered
 *    phone call on Android, a call/Siri on iOS). Neither platform records
 *    reliably for a backgrounded app without a foreground service, and on
 *    iOS expo-audio has already paused the recorder natively by the time
 *    we hear about it.
 *  - the native recorder reporting an error mid-recording (Android's
 *    MediaRecorder does this when the mic is taken away).
 *
 * Only 'background' counts, not iOS's 'inactive' -- that also fires for a
 * Control Center pull-down or an incoming notification banner, and pausing
 * a journal entry for those would be far more annoying than helpful.
 *
 * Known gap: an Android call that is *ringing* but not answered keeps the
 * app in the foreground and fires nothing here; expo-audio doesn't surface
 * audio-focus loss to JS. The recorder keeps running (possibly capturing
 * silence) until the user answers or dismisses.
 */
import type { AudioRecorder } from 'expo-audio';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export type InterruptionReason = 'background' | 'recorder-error';

export function useAudioInterruption(
  recorder: AudioRecorder,
  onInterrupt: (reason: InterruptionReason) => void
) {
  const callbackRef = useRef(onInterrupt);
  callbackRef.current = onInterrupt;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') callbackRef.current('background');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = recorder.addListener('recordingStatusUpdate', (status) => {
      if (status.hasError) callbackRef.current('recorder-error');
    });
    return () => subscription.remove();
  }, [recorder]);
}
