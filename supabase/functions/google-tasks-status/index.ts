// Whether Google Tasks is connected, as which account, and the default
// list -- the only thing about the connection the app is ever allowed to
// see (no token field is included; the connections table has no client
// RLS select policy at all, so this Edge Function, using the service
// role, is the one sanctioned read path). See Account's Google Tasks
// section (src/services/googleTasks.ts's getGoogleTasksStatus()).

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { errorMessage } from '../_shared/errorMessage.ts';

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
  const { data: connection, error } = await db
    .from('google_tasks_connections')
    .select('google_email, default_list_id, default_list_title')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('google-tasks-status failed:', error);
    return json({ error: errorMessage(error, 'Could not check Google Tasks connection.') }, 500);
  }

  if (!connection) {
    return json({ connected: false, email: null, defaultListId: null, defaultListTitle: null });
  }
  return json({
    connected: true,
    email: connection.google_email,
    defaultListId: connection.default_list_id,
    defaultListTitle: connection.default_list_title,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
