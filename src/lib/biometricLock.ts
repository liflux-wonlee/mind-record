/**
 * Device biometric/passcode lock gate for Settings -> biometric unlock (see
 * app/_layout.tsx's <LockGate> and app/account.tsx's toggle).
 *
 * This is deliberately independent of Supabase's own session storage (see
 * src/lib/secureStorage.ts): a successful check here only decides whether
 * this device shows the app's content on screen right now. It never
 * creates, refreshes, or validates a server session by itself -- an
 * expired or signed-out Supabase session still requires a real sign-in no
 * matter what this module says, and nothing here ever bypasses RLS or any
 * server-side auth check.
 *
 * Also deliberately does NOT store, transmit, or otherwise touch any actual
 * biometric data (a fingerprint image, a face scan). expo-local-
 * authentication only ever hands back a yes/no "the OS's own biometric/
 * passcode check passed", decided entirely inside the OS -- nothing
 * biometric ever reaches this app, this module, or any server. There is no
 * separate PIN/passcode system built here either: authenticateAsync's own
 * `disableDeviceFallback: false` (the default, and always what this module
 * passes) already lets the OS fall back to the device's own PIN/pattern/
 * passcode when biometrics fail or aren't available, which is the only
 * fallback this feature offers.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { withSystemDialog } from '@/lib/systemDialogGuard';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'generic';

const ENABLED_KEY_PREFIX = 'mindrecord.biometric_lock.enabled.';

export async function getBiometricSupport(): Promise<{ available: boolean; kind: BiometricKind | null }> {
  const [hasHardware, isEnrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  if (!hasHardware || !isEnrolled) return { available: false, kind: null };
  // Fingerprint checked first: many Android phones (this app's primary
  // Android userbase device, Samsung, included) report BOTH fingerprint and
  // facial-recognition as hardware-supported even when only a fingerprint
  // is actually enrolled -- expo-local-authentication has no way to ask
  // which one the user actually set up, only what the hardware CAN do. iOS
  // devices only ever report one or the other (Face ID and Touch ID are
  // mutually exclusive per device), so this order doesn't change anything
  // there.
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return { available: true, kind: 'fingerprint' };
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return { available: true, kind: 'face' };
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return { available: true, kind: 'iris' };
  }
  return { available: true, kind: 'generic' };
}

/** Device-appropriate label -- Settings and the lock screen both use this so neither says "fingerprint" on a Face-ID-only device or vice versa. */
export function biometricLabel(kind: BiometricKind | null): string {
  if (kind === 'face') return Platform.OS === 'ios' ? 'Face ID' : 'Face unlock';
  if (kind === 'fingerprint') return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint unlock';
  if (kind === 'iris') return 'Iris unlock';
  return 'Biometric unlock';
}

export async function isBiometricLockEnabled(userId: string): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(ENABLED_KEY_PREFIX + userId).catch(() => null);
  return raw === '1';
}

/** A single in-flight authenticateAsync() call at a time -- LocalAuthentication itself can misbehave if a second prompt is requested while one is already showing, and it also lets callers avoid firing overlapping prompts (e.g. Settings' toggle and the lock screen both reacting to the same AppState change). */
let authInFlight: Promise<LocalAuthentication.LocalAuthenticationResult> | null = null;

async function runAuthenticate(promptMessage: string): Promise<LocalAuthentication.LocalAuthenticationResult> {
  if (authInFlight) return authInFlight;
  const promise = withSystemDialog(() =>
    LocalAuthentication.authenticateAsync({ promptMessage, disableDeviceFallback: false })
  );
  authInFlight = promise;
  try {
    return await promise;
  } finally {
    if (authInFlight === promise) authInFlight = null;
  }
}

export async function authenticate(promptMessage: string): Promise<boolean> {
  const result = await runAuthenticate(promptMessage);
  return result.success;
}

/** Requires an actual successful OS auth before turning the lock ON -- never flips it on from the Settings toggle alone. */
export async function enableBiometricLock(userId: string): Promise<boolean> {
  const support = await getBiometricSupport();
  if (!support.available) return false;
  const ok = await authenticate('Confirm to turn on biometric unlock');
  if (!ok) return false;
  await SecureStore.setItemAsync(ENABLED_KEY_PREFIX + userId, '1');
  return true;
}

/**
 * Requires biometric/device-lock auth before turning the lock OFF. When no
 * hardware/enrollment is available any more to check against, the caller
 * is expected to have already gotten a real account re-auth (e.g. the user
 * re-entering their password) and passes `alreadyReauthenticated: true` --
 * this function never silently turns the lock off on its own in that case.
 */
export async function disableBiometricLock(
  userId: string,
  { alreadyReauthenticated = false }: { alreadyReauthenticated?: boolean } = {}
): Promise<boolean> {
  if (!alreadyReauthenticated) {
    const support = await getBiometricSupport();
    if (!support.available) return false;
    const ok = await authenticate('Confirm to turn off biometric unlock');
    if (!ok) return false;
  }
  await SecureStore.deleteItemAsync(ENABLED_KEY_PREFIX + userId).catch(() => {});
  return true;
}

/**
 * Clears this device's lock state for `userId`. Not strictly required for
 * isolation between accounts -- the enabled flag is already namespaced per
 * user id, so a different account signing in on the same device can never
 * read another account's flag -- but this is called on sign-out anyway as
 * hygiene, and MUST be called on account deletion once that flow exists.
 */
export async function clearBiometricLockState(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(ENABLED_KEY_PREFIX + userId).catch(() => {});
}
