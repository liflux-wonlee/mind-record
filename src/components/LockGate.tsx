/**
 * Decides whether to show the biometric lock overlay (see LockScreen.tsx)
 * on top of the app -- rendered as a sibling of the navigation stack in
 * app/_layout.tsx, not as a route, so the screens underneath (in
 * particular an in-progress Capture recording) are never unmounted just
 * because the lock appears.
 *
 * `active` gates this to only the signed-in, onboarded app content --
 * login/onboarding never show the lock screen, since there's nothing
 * sensitive to protect there yet.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { LockScreen } from '@/components/LockScreen';
import { isBiometricLockEnabled } from '@/lib/biometricLock';
import { isSystemDialogOpen } from '@/lib/systemDialogGuard';
import { useAuth } from '@/providers/AuthProvider';

export function LockGate({ active }: { active: boolean }) {
  const { user } = useAuth();
  const [lockEnabled, setLockEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const checkedForUserRef = useRef<string | null>(null);

  // Re-check whenever a (possibly different) user becomes active -- a
  // sign-out then a different account signing in on the same device must
  // never inherit the previous account's lock-enabled state or unlocked
  // status, since this reads the NEW user's own key (see biometricLock.ts).
  useEffect(() => {
    if (!active || !user) {
      setLockEnabled(false);
      setLocked(false);
      checkedForUserRef.current = null;
      return;
    }
    if (checkedForUserRef.current === user.id) return;
    checkedForUserRef.current = user.id;
    let cancelled = false;
    isBiometricLockEnabled(user.id).then((enabled) => {
      if (cancelled) return;
      setLockEnabled(enabled);
      // Locked by default the moment this is known to be on -- covers both
      // a fresh cold start and switching to a different lock-enabled user.
      setLocked(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [active, user]);

  // Re-lock on every return from the background, not just once at cold
  // start -- 'background' specifically (matching useAudioInterruption's
  // own choice elsewhere), not 'inactive', which also fires for things
  // like the iOS control center that aren't a real app-leave. A dialog
  // this app itself triggered (the unlock prompt, a permission request)
  // is excluded via isSystemDialogOpen() so confirming it doesn't
  // immediately re-lock the screen it just unlocked.
  useEffect(() => {
    if (!active || !lockEnabled) return;
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev === 'background' && next === 'active' && !isSystemDialogOpen()) {
        setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [active, lockEnabled]);

  if (!active || !lockEnabled || !locked) return null;
  return <LockScreen onUnlocked={() => setLocked(false)} />;
}
