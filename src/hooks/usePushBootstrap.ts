/**
 * Phone-only push wiring, mounted once by app/_layout.tsx's native navigator:
 *
 *  - registers this install (token + permission, never prompting) whenever
 *    someone signs in, on app resume when the permission changed or the
 *    registration is stale, and when the OS rotates the push token;
 *  - saves the device's IANA time zone to the profile when it differs
 *    (the reminder scheduler computes "9:00 the day before" in it);
 *  - routes a tapped reminder notification to /reminders?focus=<type>:<id>
 *    -- only once the app content is visible (signed in, onboarded, and
 *    past the biometric lock), each tap exactly once, including the tap that
 *    cold-started the app. The Reminders screen re-reads live server state,
 *    so an old notification for something finished shows a safe message.
 *
 * Nothing here starts the microphone or plays audio.
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  addNotificationTapListener,
  addPushTokenRefreshListener,
  configureNotifications,
  getPushState,
  PUSH_SUPPORTED,
  registerPushInstallation,
  takeLaunchNotificationTap,
  type NotificationTap,
} from '@/lib/push';
import { useAuth } from '@/providers/AuthProvider';
import { syncDeviceTimeZone } from '@/services/reminders';

const REREGISTER_AFTER_MS = 6 * 60 * 60 * 1000;

// Module-level so a remounted navigator never replays a tap.
const handledTaps = new Set<string>();
let lastRegistration: { userId: string; permission: string; at: number } | null = null;

async function register(userId: string) {
  try {
    const state = await registerPushInstallation();
    lastRegistration = { userId, permission: state.permission, at: Date.now() };
  } catch {
    // Offline or the server said no -- the next resume tries again.
    lastRegistration = null;
  }
}

export function usePushBootstrap({ contentOpen }: { contentOpen: boolean }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!PUSH_SUPPORTED || !userId) return;
    configureNotifications();
    register(userId);
    syncDeviceTimeZone(userId).catch(() => {});

    const tokenSub = addPushTokenRefreshListener(() => register(userId));
    const appSub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      getPushState()
        .then((state) => {
          const stale =
            !lastRegistration ||
            lastRegistration.userId !== userId ||
            lastRegistration.permission !== state.permission ||
            Date.now() - lastRegistration.at > REREGISTER_AFTER_MS;
          if (stale) register(userId);
        })
        .catch(() => {});
      syncDeviceTimeZone(userId).catch(() => {});
    });
    return () => {
      tokenSub.remove();
      appSub.remove();
    };
  }, [userId]);

  // ── notification taps ────────────────────────────────────────────────
  const pendingRef = useRef<NotificationTap | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    if (!PUSH_SUPPORTED) return;
    const accept = (tap: NotificationTap) => {
      if (!tap.data || handledTaps.has(tap.key)) return;
      handledTaps.add(tap.key);
      pendingRef.current = tap;
      setPendingTick((t) => t + 1);
    };
    const launch = takeLaunchNotificationTap();
    if (launch) accept(launch);
    const sub = addNotificationTapListener(accept);
    const appSub = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => {
      sub.remove();
      appSub.remove();
    };
  }, []);

  // A tap from before a sign-out belongs to that account -- drop it.
  useEffect(() => {
    if (!userId) pendingRef.current = null;
  }, [userId]);

  const contentOpenRef = useRef(contentOpen);
  contentOpenRef.current = contentOpen;
  useEffect(() => {
    if (!pendingRef.current || !contentOpen || !foreground) return;
    // A beat after the app comes forward: the lock gate re-locks on the
    // same 'active' transition, and the navigator must be mounted on a
    // cold start. If the lock closes meanwhile, this is cancelled and runs
    // again once it's unlocked.
    const timer = setTimeout(() => {
      const tap = pendingRef.current;
      if (!tap?.data || !contentOpenRef.current || AppState.currentState !== 'active') return;
      pendingRef.current = null;
      if (tap.data.type === 'reminder') {
        router.push({ pathname: '/reminders', params: { focus: `${tap.data.targetType}:${tap.data.targetId}` } });
      } else {
        router.push('/reminders');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [pendingTick, contentOpen, foreground]);
}
