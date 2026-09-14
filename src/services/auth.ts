/**
 * Auth — thin wrappers around Supabase Auth so screens never call
 * `supabase.auth.*` directly. See `src/providers/AuthProvider.tsx` for the
 * session/user state these actions end up feeding.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { signInWithOAuth } from '@/lib/oauth';
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
      emailRedirectTo: Linking.createURL('/'),
      data: trimmedName ? { display_name: trimmedName } : undefined,
    },
  });
  if (error) throw error;
  return data.session ? { status: 'signed-in' } : { status: 'check-email' };
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithOAuth('google');
}

/**
 * Apple only ships a native "Sign in with Apple" SDK for iOS — there is no
 * Android equivalent (Apple doesn't build one). On iOS this opens the native
 * sheet and exchanges Apple's identity token with Supabase directly; on
 * Android it throws `AppleSignInUnavailableError` so the caller can show
 * "iOS only" instead of silently doing nothing or faking success.
 */
export class AppleSignInUnavailableError extends Error {
  constructor() {
    super('Sign in with Apple is only available on iOS.');
    this.name = 'AppleSignInUnavailableError';
  }
}

export async function signInWithApple(): Promise<void> {
  if (Platform.OS !== 'ios') throw new AppleSignInUnavailableError();

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
