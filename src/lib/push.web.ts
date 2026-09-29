/**
 * Web counterpart of src/lib/push.ts. Web push is out of scope (the web
 * build is a read-only view of records), so nothing here touches
 * expo-notifications: permission reads as "not available", registration
 * and taps are no-ops, and signing out has nothing to unregister.
 */
import type { PushPermissionStatus } from '@/types/database';

export const PUSH_SUPPORTED = false;
export const REMINDER_CHANNEL_ID = 'reminders';

export type PushState = {
  permission: PushPermissionStatus;
  canAskAgain: boolean;
  tokenError: string | null;
};

export type ReminderPushData =
  | { type: 'reminder'; targetType: 'task' | 'session' | 'memory'; targetId: string; reminderId?: string; slot?: string }
  | { type: 'reminder_test' };

export type NotificationTap = { key: string; data: ReminderPushData | null };

const UNAVAILABLE: PushState = { permission: 'undetermined', canAskAgain: false, tokenError: null };

export function configureNotifications() {}

export async function getInstallationId(): Promise<string> {
  return 'web';
}

export async function getPushState(): Promise<PushState> {
  return UNAVAILABLE;
}

export async function registerPushInstallation(): Promise<PushState> {
  return UNAVAILABLE;
}

export async function unregisterPushInstallation(): Promise<void> {}

export async function requestPushPermission(): Promise<PushState> {
  return UNAVAILABLE;
}

export function openNotificationSettings() {}

export async function turnOnNotifications(): Promise<PushState> {
  return UNAVAILABLE;
}

export function addPushTokenRefreshListener(_onChange: () => void): { remove: () => void } {
  return { remove() {} };
}

export function addNotificationTapListener(_onTap: (tap: NotificationTap) => void): { remove: () => void } {
  return { remove() {} };
}

export function takeLaunchNotificationTap(): NotificationTap | null {
  return null;
}
