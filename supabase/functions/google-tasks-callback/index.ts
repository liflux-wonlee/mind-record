// Step 2 of connecting Google Tasks: Google redirects the browser here
// directly (this is the `redirect_uri` google-tasks-connect-start put in
// the consent URL) with `code`/`state` in the query string -- there is no
// Authorization header on this request at all, which is exactly why
// connect-start minted a single-use `state` bound to a user id first. This
// function must be deployed WITHOUT JWT verification:
//   supabase functions deploy google-tasks-callback --no-verify-jwt
// (the gateway would otherwise reject Google's redirect before this code
// ever runs, since Google has no Supabase session to present).
//
// Exchanges the code for tokens SERVER-SIDE ONLY -- the refresh token
// (and the client secret used to get it) never reach the app; the app
// only ever learns "connected, as whom" via google-tasks-status. Verifies
// the connected Google account through Google's own userinfo endpoint
// (the server-verified sub/email), never trusting anything client-sent.
// Finishes by redirecting the browser to mindrecord://google-tasks/callback
// so src/lib/oauth.ts-style WebBrowser.openAuthSessionAsync() on the app
// side resolves and the app can check the result.
//
// GOOGLE CLOUD CONSOLE SETUP (one-time, console-only):
//   1. APIs & Services -> Library -> enable the "Google Tasks API".
//   2. APIs & Services -> Credentials -> Create Credentials -> OAuth
//      client ID -> Application type "Web application".
//   3. Authorized redirect URIs: add exactly
//        https://<your-project-ref>.supabase.co/functions/v1/google-tasks-callback
//   4. Set both the client ID and client secret as Supabase secrets ONLY --
//      neither one is ever read by the app itself (google-tasks-connect-
//      start builds the whole consent URL server-side and hands the app a
//      ready-made link, so there is nothing Google-related to add to the
//      app's own .env for this feature):
//        supabase secrets set GOOGLE_TASKS_CLIENT_ID=... GOOGLE_TASKS_CLIENT_SECRET=...
//   5. OAuth consent screen: add the `.../auth/tasks` scope, and while the
//      app is unverified/in testing, add every test Google account under
//      "Test users" or Google will refuse the consent screen for them.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { GOOGLE_TASKS_CLIENT_ID, GOOGLE_TASKS_CLIENT_SECRET } from '../_shared/googleTasks.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const APP_REDIRECT = 'mindrecord://google-tasks/callback';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const googleError = url.searchParams.get('error');

  if (googleError) {
    return appRedirect('error', googleError === 'access_denied' ? 'cancelled' : googleError);
  }
  if (!code || !state) {
    return appRedirect('error', 'missing_parameters');
  }
  if (!GOOGLE_TASKS_CLIENT_ID || !GOOGLE_TASKS_CLIENT_SECRET) {
    return appRedirect('error', 'not_configured');
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Single-use + expiring: a state older than 10 minutes or already
    // consumed is rejected outright, same protection an OAuth `state`
    // parameter is meant to give against a replayed/forged callback.
    const { data: stateRow, error: stateError } = await db
      .from('google_tasks_oauth_states')
      .select('user_id, created_at, used_at')
      .eq('state', state)
      .maybeSingle();
    if (stateError) throw stateError;
    if (!stateRow || stateRow.used_at || Date.now() - new Date(stateRow.created_at).getTime() > 10 * 60 * 1000) {
      return appRedirect('error', 'invalid_state');
    }
    await db.from('google_tasks_oauth_states').update({ used_at: new Date().toISOString() }).eq('state', state);
    const userId = stateRow.user_id;

    const redirectUri = `${SUPABASE_URL}/functions/v1/google-tasks-callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_TASKS_CLIENT_ID,
        client_secret: GOOGLE_TASKS_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      console.error('google-tasks-callback token exchange failed:', await tokenRes.text());
      return appRedirect('error', 'token_exchange_failed');
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string | undefined;
    if (!refreshToken) {
      // Should not happen with access_type=offline&prompt=consent, but if
      // Google ever omits it, there is nothing to store for future sends --
      // never silently reuse a stale/previous account's refresh token here.
      return appRedirect('error', 'no_refresh_token');
    }
    const expiresInSec = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;

    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoRes.ok) {
      console.error('google-tasks-callback userinfo failed:', await userinfoRes.text());
      return appRedirect('error', 'userinfo_failed');
    }
    const userinfo = await userinfoRes.json();
    const googleSub = userinfo.sub as string;
    const googleEmail = (userinfo.email as string) ?? '';

    // Upsert by OUR user_id -- reconnecting (even a different Google
    // account) only ever replaces this row's tokens, never touches
    // auth.users or any content table.
    const { error: upsertError } = await db.from('google_tasks_connections').upsert(
      {
        user_id: userId,
        google_sub: googleSub,
        google_email: googleEmail,
        refresh_token: refreshToken,
        access_token: accessToken,
        access_token_expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (upsertError) throw upsertError;

    return appRedirect('connected');
  } catch (e) {
    console.error('google-tasks-callback failed:', e);
    return appRedirect('error', 'unexpected');
  }
});

function appRedirect(status: 'connected' | 'error', message?: string): Response {
  const target = new URL(APP_REDIRECT);
  target.searchParams.set('status', status);
  if (message) target.searchParams.set('message', message);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}
