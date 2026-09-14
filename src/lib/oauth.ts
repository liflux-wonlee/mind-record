/**
 * Web-based OAuth (Google, and Apple on Android) via Supabase's hosted
 * `/authorize` endpoint + an in-app browser tab.
 *
 * Apple on iOS does NOT go through here — it uses the native Sign in with
 * Apple sheet instead (see `src/services/auth.ts`'s `signInWithApple`),
 * which is both the nicer UX and what the App Store requires once another
 * third-party login is offered.
 */
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export type OAuthProvider = 'google' | 'apple';

export class OAuthCancelledError extends Error {
  constructor() {
    super('The sign-in browser was closed before finishing.');
    this.name = 'OAuthCancelledError';
  }
}

/**
 * Opens the provider's sign-in page in an in-app browser, and resolves once
 * Supabase has redirected back and the session has been exchanged and
 * persisted. Throws `OAuthCancelledError` if the user dismisses the browser,
 * and rethrows whatever Supabase reports for a real auth failure.
 */
export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  // expo-router's deep link target — app/auth/callback.tsx exists as a
  // fallback landing screen for when the redirect *isn't* intercepted by
  // WebBrowser (see the waitForSession() fallback below and that screen's
  // own comment for why that happens on Android).
  const redirectTo = Linking.createURL('/auth/callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase did not return an authorization URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'success') {
    const url = new URL(result.url);
    // Supabase's default flow is PKCE, which returns `?code=...`.
    const code = url.searchParams.get('code');
    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
      return;
    }

    // Fallback for an implicit-flow project (`#access_token=...&refresh_token=...`).
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    if (accessToken && refreshToken) {
      const { error: setError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (setError) throw setError;
      return;
    }

    const errorDescription =
      url.searchParams.get('error_description') ?? hashParams.get('error_description');
    if (errorDescription) throw new Error(errorDescription);
    // No error, no code, no tokens -- fall through to the poll below.
  }

  // On Android, Chrome Custom Tabs sometimes hands the mindrecord://
  // redirect straight to the OS instead of back to this browser session
  // (the app then opens app/auth/callback.tsx directly, and this promise
  // resolves with type 'dismiss' or a URL with no usable payload). The
  // deep link still reaches src/providers/AuthProvider.tsx's own listener,
  // which may finish the sign-in a moment after this promise settles --
  // check for that before reporting a false cancellation.
  if (await waitForSession()) return;
  throw new OAuthCancelledError();
}

async function waitForSession(timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}
