import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// Bump the suffix to show the intro again to everyone after a big change.
const KEY = 'mindrecord.onboarding.done.v1';

// The flag gates routes in app/_layout.tsx, so a change has to reach that
// hook immediately (not on next launch) -- tiny in-process pub/sub.
let current: boolean | null = null;
const listeners = new Set<(done: boolean) => void>();
function publish(done: boolean) {
  current = done;
  listeners.forEach((l) => l(done));
}

export async function markOnboardingDone(): Promise<void> {
  publish(true);
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // Worst case the intro shows once more next launch.
  }
}

export async function resetOnboarding(): Promise<void> {
  publish(false);
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** null while still reading from storage. */
export function useOnboardingDone(): boolean | null {
  const [done, setDone] = useState<boolean | null>(current);
  useEffect(() => {
    listeners.add(setDone);
    if (current === null) {
      AsyncStorage.getItem(KEY)
        .then((v) => publish(v === '1'))
        .catch(() => publish(true)); // storage unavailable: don't trap the user in the intro
    }
    return () => {
      listeners.delete(setDone);
    };
  }, []);
  return done;
}
