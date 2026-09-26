/**
 * Social sign-in for the web build (see socialAuth.ts for iOS/Android).
 *
 * Google: Supabase's hosted OAuth, as a full-page redirect -- the browser
 * goes to Google, then back to `<this origin>/auth/callback?code=...`,
 * where src/providers/AuthProvider.tsx exchanges the code (PKCE, see
 * src/lib/supabase.ts) for a session. Same Supabase project and the same
 * Google identity as the mobile app's native sign-in, so the same account
 * (same user id) signs in -- nothing is merged by email.
 *
 * Needs, outside the code (see docs/WEB_PREPARATION.md): the Google
 * provider enabled in Supabase with a Web client ID + secret, the
 * Supabase callback URL registered on that Google client, and this site's
 * `/auth/callback` URL in Supabase's Redirect URLs allow-list.
 *
 * Apple: not offered on the web yet (no web Services ID set up); the login
 * screen hides it here.
 */
import { supabase } from '@/lib/supabase';
import { AppleSignInUnavailableError } from '@/services/socialAuthErrors';

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = `${window.location.origin}/auth/callback`;
  // supabase-js navigates the page to Google itself (skipBrowserRedirect
  // unset), so on success this tab is about to leave.
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function signInWithApple(): Promise<void> {
  throw new AppleSignInUnavailableError('Sign in with Apple is not available on the web yet.');
}
