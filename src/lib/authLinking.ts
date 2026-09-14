/**
 * Handles the deep link Supabase sends the user back to after clicking an
 * email confirmation link (also covers magic links / password resets later,
 * since they redirect the same way).
 *
 * This is a DIFFERENT path from Google/Apple sign-in (see src/lib/oauth.ts):
 * OAuth's redirect is caught synchronously by the in-app browser session
 * (`WebBrowser.openAuthSessionAsync`) while the app is already in the
 * foreground. An email link is opened from the Mail app instead — there is
 * no browser session waiting for it, so the app has to listen globally for
 * the incoming URL (cold start or already running) and pull the session out
 * of it itself. `detectSessionInUrl` is off in src/lib/supabase.ts (there is
 * no browser URL bar to auto-read on native), so nothing does this
 * automatically.
 */
import { supabase } from '@/lib/supabase';

export type AuthLinkResult =
  /** The URL had no auth payload at all — not a link this handles. */
  | { status: 'ignored' }
  | { status: 'handled' }
  | { status: 'error'; message: string };

export async function processAuthDeepLink(url: string): Promise<AuthLinkResult> {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const hashParams = new URLSearchParams(hash);

  const queryIndex = url.indexOf('?');
  const query =
    queryIndex === -1 ? '' : url.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);
  const queryParams = new URLSearchParams(query);

  const errorDescription = hashParams.get('error_description') ?? queryParams.get('error_description');
  if (errorDescription) {
    return { status: 'error', message: decodeURIComponent(errorDescription.replace(/\+/g, ' ')) };
  }

  // Supabase's /auth/v1/verify endpoint (used for signup confirmation,
  // magic links, and password recovery) redirects with tokens in the hash.
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return { status: 'error', message: error.message };
    return { status: 'handled' };
  }

  // PKCE-style redirect (?code=...) — not what /verify currently sends, but
  // handled in case that ever changes, and it's the same param OAuth uses.
  const code = queryParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { status: 'error', message: error.message };
    return { status: 'handled' };
  }

  return { status: 'ignored' };
}
