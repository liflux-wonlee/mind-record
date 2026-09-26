/**
 * Auth — thin wrappers around Supabase Auth so screens never call
 * `supabase.auth.*` directly. See `src/providers/AuthProvider.tsx` for the
 * session/user state these actions end up feeding.
 */
import * as Linking from 'expo-linking';

import { clearBiometricLockState } from '@/lib/biometricLock';
import { supabase } from '@/lib/supabase';

export type EmailAuthResult =
  | { status: 'signed-in' }
  /** Supabase's "Confirm email" setting is on — no session yet until the user clicks the link. */
  | { status: 'check-email' };

/**
 * `emailRedirectTo` makes the confirmation link land back on Home via a
 * deep link the app actually listens for (see `src/lib/authLinking.ts`),
 * instead of falling back to Supabase's dashboard-configured Site URL.
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string
): Promise<EmailAuthResult> {
  const trimmedName = displayName?.trim();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Must be listed verbatim under Supabase -> Auth -> URL Configuration
      // -> Redirect URLs (mindrecord://auth/callback), or the confirmation
      // link falls back to the dashboard's Site URL and never reaches the app.
      emailRedirectTo: Linking.createURL('auth/callback'),
      data: trimmedName ? { display_name: trimmedName } : undefined,
    },
  });
  if (error) throw error;
  // With email confirmation on, signing up an address that already has an
  // account returns a stub user with no identities and sends NO email --
  // reporting "check your email" there strands the user.
  if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
    throw new Error('An account with this email already exists. Sign in instead.');
  }
  return data.session ? { status: 'signed-in' } : { status: 'check-email' };
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export { signInWithApple, signInWithGoogle } from '@/services/socialAuth';
export { AppleSignInUnavailableError } from '@/services/socialAuthErrors';

export async function signOut(): Promise<void> {
  // Read before signing out -- getUser() has nothing to return once the
  // session is gone, and a new account signing in on this device next must
  // never inherit this one's biometric-lock state (see clearBiometricLockState).
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  if (userId) await clearBiometricLockState(userId).catch(() => {});
}
