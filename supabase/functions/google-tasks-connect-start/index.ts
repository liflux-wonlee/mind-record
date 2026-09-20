// Step 1 of connecting Google Tasks (Account -> Google Tasks -> Connect):
// mints a single-use state bound to the caller and returns Google's
// consent URL for the app to open in a browser session (see
// src/services/googleTasks.ts's connectGoogleTasks()).
//
// Deliberately a SEPARATE OAuth client/consent screen from login's Google
// Sign-In (src/services/auth.ts) -- connecting Google Tasks never touches
// the base Google login, and a user who signed in with Apple or email can
// connect Google Tasks too. `access_type=offline&prompt=consent` guarantee
// a refresh_token comes back even if this Google account already granted
// access before (Google otherwise silently omits it on a repeat consent).
//
// Invoked via
//   supabase.functions.invoke('google-tasks-connect-start')
//
// Requires the GOOGLE_TASKS_CLIENT_ID / GOOGLE_TASKS_CLIENT_SECRET secrets
// (see google-tasks-callback's header comment for the Google Cloud Console
// setup) and SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { errorMessage } from '../_shared/errorMessage.ts';
import { GOOGLE_TASKS_CLIENT_ID } from '../_shared/googleTasks.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (!GOOGLE_TASKS_CLIENT_ID) {
    return json({ error: 'Google Tasks is not configured on this project.' }, 500);
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const state = crypto.randomUUID() + crypto.randomUUID();
    const { error } = await db.from('google_tasks_oauth_states').insert({ state, user_id: user.id });
    if (error) throw error;

    const redirectUri = `${SUPABASE_URL}/functions/v1/google-tasks-callback`;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_TASKS_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/tasks openid email');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    return json({ authUrl: authUrl.toString() });
  } catch (e) {
    console.error('google-tasks-connect-start failed:', e);
    return json({ error: errorMessage(e, 'Could not start connecting Google Tasks.') }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
