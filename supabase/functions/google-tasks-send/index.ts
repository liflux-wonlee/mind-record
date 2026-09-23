// Sends one task or idea to Google Tasks -- ONLY ever called from a Tasks/
// Ideas item's own menu (an explicit voice request goes through converse,
// which uses the same helper); never automatically just because something
// was extracted from a recording. See src/services/googleTasks.ts's
// sendToGoogleTasks() and the Tasks screen's "Send to Google Tasks" action.
//
// Which Google list: a task in one of the app's lists goes to the Google
// list chosen for it, or by default the one with the same name (created
// if missing); anything else goes to the default list -- see
// _shared/googleTasks.ts's sendToGoogleTasks().
//
// due only ever carries a DATE -- the Google Tasks API has no time-of-day
// field at all, so a spoken "오후 3시" (3pm) stays in the task's notes as
// plain text; this never claims to have set a time-based reminder.
//
// Idempotent by construction: google_tasks_sends has a unique constraint
// per (task_id | memory_id, list), so re-sending the same item to the
// same list returns the EXISTING send instead of creating a second Google
// Task -- covers a double-tap and a client retry after a dropped response
// alike, as long as the first attempt's insert made it into that table (a
// response lost between Google actually creating the task and this
// function's own insert is a real, if rare, gap the Tasks API's lack of
// an idempotency-key parameter doesn't give a clean way to close).
// Sending the SAME item to a DIFFERENT list is a distinct, separate send.

import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import { errorMessage } from '../_shared/errorMessage.ts';
import {
  ItemNotFoundError,
  MappedListMissingError,
  NeedsListError,
  NotConnectedError,
  sendToGoogleTasks,
} from '../_shared/googleTasks.ts';

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

  let itemType: unknown;
  let itemId: unknown;
  let listId: unknown;
  try {
    ({ itemType, itemId, listId } = await req.json());
  } catch {
    // handled below
  }
  if ((itemType !== 'task' && itemType !== 'memory') || typeof itemId !== 'string' || !itemId) {
    return json({ error: 'itemType ("task" or "memory") and itemId are required.' }, 400);
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

  // Service role, with every read/write scoped to this user's id inside
  // sendToGoogleTasks (a non-owned item id simply isn't found).
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const result = await sendToGoogleTasks(db, user.id, { kind: itemType, id: itemId }, {
      listId: typeof listId === 'string' && listId ? listId : undefined,
    });
    return json(result);
  } catch (e) {
    // 200, not 4xx, for the expected, actionable states -- the client
    // reads these flags straight off `data` instead of unwrapping a thrown
    // FunctionsHttpError.
    if (e instanceof NotConnectedError) return json({ error: 'Google Tasks is not connected.', notConnected: true });
    if (e instanceof NeedsListError) return json({ error: e.message, needsList: true });
    if (e instanceof MappedListMissingError) return json({ error: e.message, mappedListMissing: true });
    if (e instanceof ItemNotFoundError) return json({ error: 'Not found.' }, 404);
    console.error('google-tasks-send failed:', e);
    return json({ error: errorMessage(e, 'Could not send this to Google Tasks.') }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
