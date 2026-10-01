/**
 * Mobile push for reminders (see supabase/migrations/20260929000001_reminders.sql
 * and docs in the reminders-dispatch Edge Function). The server decides
 * WHEN a reminder goes out and sends it through Expo Push; this module only:
 *
 *  - keeps a stable per-install id (AsyncStorage) so one phone is one
 *    `push_installations` row no matter how often its token changes;
 *  - reads the notification permission WITHOUT prompting and registers the
 *    token + permission for whoever is signed in (the row moves to that
 *    account, so another account never gets this one's pushes);
 *  - asks for permission only from an explicit user action
 *    (requestPushPermission / turnOnNotifications) -- never on its own;
 *  - unregisters on sign-out, before the session is cleared;
 *  - shows a foreground notification as a normal banner. Nothing here ever
 *    starts the microphone or speaks: a notification arriving or being
 *    tapped only opens the Reminders list (see usePushBootstrap).
 *
 * Web gets src/lib/push.web.ts instead (no native module at all).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { withSystemDialog } from '@/lib/systemDialogGuard';
import type { PushPermissionStatus } from '@/types/database';

export const PUSH_SUPPORTED = true;
export const REMINDER_CHANNEL_ID = 'reminders';
const INSTALLATION_KEY = 'joaassistant.push.installationId.v1';

export type PushState = {
  permission: PushPermissionStatus;
  /** False once the OS won't show the prompt again (only Settings can turn it on). */
  canAskAgain: boolean;
  /** Why the last registration couldn't get a push token (e.g. a build without FCM set up). */
  tokenError: string | null;
};

/** The data a reminder push carries (set by reminders-dispatch). */
export type ReminderPushData =
  | { type: 'reminder'; targetType: 'task' | 'session' | 'memory'; targetId: string; reminderId?: string; slot?: string }
  | { type: 'reminder_test' };

let configured = false;
let lastTokenError: string | null = null;
let installationIdPromise: Promise<string> | null = null;

/** Foreground banner + the Android channel. Safe to call more than once. */
export function configureNotifications() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      // The system's own banner and sound only -- no speech, no mic.
      // (On Android shouldPlaySound: false also hides the heads-up banner.)
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  ensureChannel().catch(() => {});
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  // Must exist before Android 13+ can show the permission prompt at all.
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: 'Reminders',
    description: 'Tasks and notes you asked to be reminded about',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    lightColor: '#ef8a80',
  });
}

export function getInstallationId(): Promise<string> {
  if (!installationIdPromise) {
    installationIdPromise = (async () => {
      try {
        const existing = await AsyncStorage.getItem(INSTALLATION_KEY);
        if (existing) return existing;
      } catch {
        // Fall through to a new id.
      }
      const id = Crypto.randomUUID();
      await AsyncStorage.setItem(INSTALLATION_KEY, id).catch(() => {});
      return id;
    })();
  }
  return installationIdPromise;
}

function toStatus(p: Notifications.NotificationPermissionsStatus): PushPermissionStatus {
  if (p.granted) return 'granted';
  // iOS "provisional" (quiet delivery) still delivers.
  if (p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return p.status === 'denied' ? 'denied' : 'undetermined';
}

/** Reads the permission without ever prompting. */
export async function getPushState(): Promise<PushState> {
  configureNotifications();
  const p = await Notifications.getPermissionsAsync();
  return { permission: toStatus(p), canAskAgain: p.canAskAgain !== false, tokenError: lastTokenError };
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/**
 * Registers this install for the signed-in account with its current
 * permission (and token, when granted). Never prompts. Called on sign-in,
 * app start/resume and token refresh.
 */
export async function registerPushInstallation(): Promise<PushState> {
  configureNotifications();
  await ensureChannel().catch(() => {});
  const p = await Notifications.getPermissionsAsync();
  const permission = toStatus(p);
  let token: string | null = null;
  if (permission === 'granted') {
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId: projectId() })).data;
      lastTokenError = null;
    } catch (e) {
      // e.g. an Android build without google-services.json (FCM), or offline.
      lastTokenError = e instanceof Error ? e.message : String(e);
    }
  } else {
    lastTokenError = null;
  }
  const installationId = await getInstallationId();
  const { error } = await supabase.rpc('register_push_installation', {
    p_installation_id: installationId,
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    p_permission: permission,
  });
  if (error) throw error;
  return { permission, canAskAgain: p.canAskAgain !== false, tokenError: lastTokenError };
}

/** Removes this install from the signed-in account. Must run while the session is still valid. */
export async function unregisterPushInstallation(): Promise<void> {
  const installationId = await getInstallationId();
  const { error } = await supabase.rpc('unregister_push_installation', { p_installation_id: installationId });
  if (error) throw error;
}

/**
 * The OS prompt -- only ever from a button the user pressed. Returns the
 * resulting state; when the OS won't ask again, `canAskAgain` is false and
 * the caller should offer openNotificationSettings().
 */
export async function requestPushPermission(): Promise<PushState> {
  configureNotifications();
  await ensureChannel().catch(() => {});
  const current = await Notifications.getPermissionsAsync();
  if (toStatus(current) !== 'granted' && current.canAskAgain !== false) {
    await withSystemDialog(() => Notifications.requestPermissionsAsync());
  }
  try {
    return await registerPushInstallation();
  } catch {
    // Saving it failed (offline) -- the permission itself is still what the OS says.
    return getPushState();
  }
}

export function openNotificationSettings() {
  Linking.openSettings().catch(() => {});
}

/**
 * "Turn on notifications": prompt if the OS still can, otherwise explain and
 * offer the system settings. Resolves with the final state.
 */
export async function turnOnNotifications(): Promise<PushState> {
  const state = await requestPushPermission();
  if (state.permission !== 'granted' && !state.canAskAgain) {
    Alert.alert(
      'Notifications are off',
      'Turn on notifications for this app in your phone’s Settings to get reminders.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: openNotificationSettings },
      ]
    );
  }
  return state;
}

/** Re-registers whenever the OS hands out a new push token. */
export function addPushTokenRefreshListener(onChange: () => void): { remove: () => void } {
  return Notifications.addPushTokenListener(() => onChange());
}

export type NotificationTap = { key: string; data: ReminderPushData | null };

function toTap(response: Notifications.NotificationResponse): NotificationTap {
  const data = response.notification.request.content.data as Record<string, unknown> | undefined;
  let parsed: ReminderPushData | null = null;
  if (data?.type === 'reminder_test') parsed = { type: 'reminder_test' };
  else if (
    data?.type === 'reminder' &&
    (data.targetType === 'task' || data.targetType === 'session' || data.targetType === 'memory') &&
    typeof data.targetId === 'string'
  ) {
    parsed = {
      type: 'reminder',
      targetType: data.targetType,
      targetId: data.targetId,
      reminderId: typeof data.reminderId === 'string' ? data.reminderId : undefined,
      slot: typeof data.slot === 'string' ? data.slot : undefined,
    };
  }
  return { key: `${response.notification.request.identifier}|${response.actionIdentifier}`, data: parsed };
}

/** Taps while the app is running (foreground or background). */
export function addNotificationTapListener(onTap: (tap: NotificationTap) => void): { remove: () => void } {
  return Notifications.addNotificationResponseReceivedListener((response) => onTap(toTap(response)));
}

/** The tap that cold-started the app, if any -- cleared so it's only handled once. */
export function takeLaunchNotificationTap(): NotificationTap | null {
  try {
    const response = Notifications.getLastNotificationResponse();
    if (!response) return null;
    Notifications.clearLastNotificationResponse();
    return toTap(response);
  } catch {
    return null;
  }
}
