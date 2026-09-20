// Remembers which Google Tasks list new sends go to by default (Account's
// list picker; see src/services/googleTasks.ts's setDefaultGoogleTaskList()).
// A send can still target a different list explicitly -- this only sets
// what's pre-selected, and only what was actually ambiguous (the target
// list) needs asking about; title/notes/date never do.

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

  let listId: string | undefined;
  let listTitle: string | undefined;
  try {
    ({ listId, listTitle } = await req.json());
  } catch {
    // handled below
  }
  if (!listId) return json({ error: 'listId is required.' }, 400);

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await db
    .from('google_tasks_connections')
    .update({ default_list_id: listId, default_list_title: listTitle ?? null })
    .eq('user_id', user.id);
  if (error) return json({ error: error.message }, 500);

  return json({ status: 'ok' });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
