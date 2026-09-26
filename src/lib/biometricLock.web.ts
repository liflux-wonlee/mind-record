/**
 * Web counterpart of src/lib/biometricLock.ts. The device biometric lock is
 * a mobile feature (it protects the app's screen on a phone that stays
 * signed in); browsers have no expo-local-authentication, and web
 * biometrics / passkeys are out of scope for now. So on the web the lock
 * is honestly "not available": it is never reported as enabled, so the web
 * app can't get stuck behind a lock screen it has no way to unlock -- and
 * nothing here touches the lock setting stored on the user's phone.
 */
export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'generic';

export async function getBiometricSupport(): Promise<{ available: boolean; kind: BiometricKind | null }> {
  return { available: false, kind: null };
}

export function biometricLabel(_kind: BiometricKind | null): string {
  return 'Biometric unlock';
}

export async function isBiometricLockEnabled(_userId: string): Promise<boolean> {
  return false;
}

export async function authenticate(_promptMessage: string): Promise<boolean> {
  return false;
}

export async function enableBiometricLock(_userId: string): Promise<boolean> {
  return false;
}

export async function disableBiometricLock(
  _userId: string,
  _options: { alreadyReauthenticated?: boolean } = {}
): Promise<boolean> {
  return false;
}

/** Nothing is stored in the browser for the lock, so there's nothing to clear. */
export async function clearBiometricLockState(_userId: string): Promise<void> {}
