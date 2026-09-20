// The user's Google Tasks lists, for Account's "Default list" picker
// (src/services/googleTasks.ts's listGoogleTaskLists()).

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { errorMessage } from '../_shared/errorMessage.ts';
import { getValidAccessToken, googleTasksFetch, NotConnectedError } from '../_shared/googleTasks.ts';

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

  try {
    const { accessToken } = await getValidAccessToken(db, user.id);
    const res = await googleTasksFetch(accessToken, 'users/@me/lists');
    if (!res.ok) {
      console.error('Google Tasks API (lists) failed:', res.status, await res.text());
      throw new Error('Could not load your Google Tasks lists.');
    }
    const data = await res.json();
    const lists = (data.items ?? []).map((l: { id: string; title: string }) => ({ id: l.id, title: l.title }));
    return json({ lists });
  } catch (e) {
    // 200, not 409 -- this is an expected, actionable state the client
    // reads straight off `data`, not a thrown FunctionsHttpError.
    if (e instanceof NotConnectedError) return json({ error: e.message, notConnected: true });
    console.error('google-tasks-lists failed:', e);
    return json({ error: errorMessage(e, 'Could not load your Google Tasks lists.') }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
