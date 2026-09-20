// Disconnects Google Tasks (Account's "Disconnect" button; see
// src/services/googleTasks.ts's disconnectGoogleTasks()). Best-effort
// revokes the token with Google (so the grant also disappears from the
// user's Google account permissions page, not just from our own DB), then
// always removes the connection row regardless of whether the revoke
// call succeeded -- a user asking to disconnect must not stay "connected"
// here just because Google's revoke endpoint had a bad moment.
//
// Deliberately does NOT touch google_tasks_sends (the "already sent"
// history) or anything in Google Tasks itself -- an item already sent
// stays sent; disconnecting only stops FUTURE sends.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

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
  const { data: connection } = await db
    .from('google_tasks_connections')
    .select('refresh_token')
    .eq('user_id', user.id)
    .maybeSingle();

  if (connection?.refresh_token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: connection.refresh_token }),
      });
    } catch (e) {
      console.warn('google-tasks-disconnect: revoke call failed, removing local connection anyway', e);
    }
  }

  const { error } = await db.from('google_tasks_connections').delete().eq('user_id', user.id);
  if (error) return json({ error: error.message }, 500);

  return json({ status: 'disconnected' });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
