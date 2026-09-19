/**
 * Recording while the screen is off or another app is in front needs a
 * foreground service on Android (expo-audio provides one; the
 * `enableBackgroundRecording` plugin flag in app.json registers it) and
 * that service needs a persistent notification, which on Android 13+ needs
 * the POST_NOTIFICATIONS runtime permission. iOS just needs the `audio`
 * background mode, which the same plugin flag adds.
 *
 * Returns whether background recording can be enabled for this run. A
 * refusal is not fatal: the caller falls back to pausing when the app is
 * backgrounded (see useAudioInterruption).
 */
import { PermissionsAndroid, Platform } from 'react-native';

import { withSystemDialog } from '@/lib/systemDialogGuard';

export async function ensureBackgroundRecordingAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version < 33) return true;
  try {
    // The permission dialog itself can briefly flick AppState through
    // 'background' -- withSystemDialog keeps the biometric lock gate from
    // reading that as a real app-leave and re-locking right on top of it.
    const result = await withSystemDialog(() =>
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Keep recording with the screen off',
        message:
          'Mind Record shows a small "Recording" notification so Android lets it keep listening while the screen is off or you switch apps. Without it, recording pauses whenever you leave the app.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      })
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
