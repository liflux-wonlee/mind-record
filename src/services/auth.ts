/**
 * Auth — thin wrappers around Supabase Auth so screens never call
 * `supabase.auth.*` directly. See `src/providers/AuthProvider.tsx` for the
 * session/user state these actions end up feeding.
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { OAuthCancelledError } from '@/lib/oauth';
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

/**
 * Native Google Sign-In (the account picker Android/iOS show for every
 * app, not a browser tab) -- replaces an earlier web-relay implementation
 * that went through Supabase's hosted `/authorize` endpoint + an in-app
 * browser (see git history / src/lib/oauth.ts). That approach showed the
 * Supabase project's own URL on the consent screen instead of "Mind
 * Record" and, on Android, was unreliable about the browser tab handing
 * control back to the app. Going native sidesteps both: there's no browser
 * step at all, Google hands back an ID token directly, and Supabase
 * verifies it the same way it already does for Apple (see
 * `signInWithApple` below) via `signInWithIdToken`.
 *
 * NOTE: app.json's `plugins` array deliberately does NOT list
 * "@react-native-google-signin/google-signin" (an `expo install` will try
 * to re-add it as a bare string). Passing no options makes the package's
 * config plugin apply Firebase-based Android setup
 * (AndroidConfig.GoogleServices.withGoogleServicesFile, expecting a
 * google-services.json this project doesn't have and doesn't need); the
 * non-Firebase path it offers instead requires an `iosUrlScheme` we don't
 * have yet either (no iOS Google client set up). Neither branch touches
 * Android beyond the Firebase-specific wiring, so for this Android-only,
 * non-Firebase setup the native module works correctly via plain
 * autolinking with no plugin entry at all -- confirmed by reading the
 * plugin's source (node_modules/@react-native-google-signin/google-signin/
 * plugin/build/withGoogleSignIn.js) directly, since this isn't documented
 * anywhere reachable from this environment.
 */
export async function signInWithGoogle(): Promise<void> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. See the deployment checklist for the Google Cloud Console steps.'
    );
  }

  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') {
    throw new OAuthCancelledError();
  }

  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google did not return an identity token.');
  }

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
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
