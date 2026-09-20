// Sends one task or idea to Google Tasks -- ONLY ever called from a Tasks/
// Ideas item's own menu, or an explicit user voice request; never
// automatically just because something was extracted from a recording.
// See src/services/googleTasks.ts's sendToGoogleTasks() and the Tasks
// screen's "Send to Google Tasks" item action.
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

import { getValidAccessToken, googleTasksFetch, NotConnectedError } from '../_shared/googleTasks.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ItemType = 'task' | 'memory';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let itemType: ItemType | undefined;
  let itemId: string | undefined;
  let listId: string | undefined;
  try {
    ({ itemType, itemId, listId } = await req.json());
  } catch {
    // handled below
  }
  if ((itemType !== 'task' && itemType !== 'memory') || !itemId) {
    return json({ error: 'itemType ("task" or "memory") and itemId are required.' }, 400);
  }

  // The caller's own JWT-bound client -- reading the task/memory this way
  // means RLS alone proves ownership; a non-owned id just returns nothing,
  // no separate check needed.
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
    let title: string;
    let notes: string | null;
    let due: string | undefined;

    if (itemType === 'task') {
      const { data: task, error } = await callerClient
        .from('tasks')
        .select('id, title, description, due_date')
        .eq('id', itemId)
        .maybeSingle();
      if (error) throw error;
      if (!task) return json({ error: 'Task not found.' }, 404);
      title = task.title;
      notes = task.description;
      // Google Tasks' `due` field only stores a date -- the time-of-day
      // portion is ignored by the API entirely, never actually shown or
      // alarmed on, so this always sends midnight UTC for the given date
      // rather than implying a real time was set.
      due = task.due_date ? `${task.due_date}T00:00:00.000Z` : undefined;
    } else {
      const { data: memory, error } = await callerClient
        .from('memories')
        .select('id, content')
        .eq('id', itemId)
        .maybeSingle();
      if (error) throw error;
      if (!memory) return json({ error: 'Idea not found.' }, 404);
      title = memory.content.length > 200 ? `${memory.content.slice(0, 199)}…` : memory.content;
      notes = memory.content.length > 200 ? memory.content : null;
    }

    const itemColumn = itemType === 'task' ? 'task_id' : 'memory_id';

    const { accessToken, connection } = await getValidAccessToken(db, user.id);
    const targetListId = listId ?? connection.default_list_id;
    if (!targetListId) {
      // 200, not 400 -- this is an expected, actionable state (not an
      // error the client needs to unwrap from a thrown FunctionsHttpError),
      // same reasoning as the notConnected branch below.
      return json({ error: 'Choose a Google Tasks list first (Settings -> Google Tasks).', needsList: true });
    }

    const { data: existing, error: existingError } = await db
      .from('google_tasks_sends')
      .select('*')
      .eq(itemColumn, itemId)
      .eq('google_task_list_id', targetListId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return json({ status: 'already_sent', googleTaskId: existing.google_task_id, listId: targetListId });
    }

    const res = await googleTasksFetch(accessToken, `lists/${encodeURIComponent(targetListId)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, notes: notes ?? undefined, due }),
    });
    if (!res.ok) throw new Error(`Google Tasks API failed (${res.status}): ${await res.text()}`);
    const created = await res.json();

    const insertPayload = {
      user_id: user.id,
      [itemColumn]: itemId,
      google_task_list_id: targetListId,
      google_task_list_title: connection.default_list_title,
      google_task_id: created.id as string,
    };
    const { error: insertError } = await db.from('google_tasks_sends').insert(insertPayload);
    if (insertError) {
      // A unique-violation here means a concurrent request (a double-tap)
      // already recorded this exact send while this one was in flight --
      // the Google Task this call just created is then a harmless
      // duplicate on Google's side, but Mind Record's own record of "was
      // this sent" stays correct and singular either way.
      if (insertError.code !== '23505') throw insertError;
    }

    return json({ status: 'sent', googleTaskId: created.id, listId: targetListId });
  } catch (e) {
    if (e instanceof NotConnectedError) {
      // 200, not 409 -- see the needsList branch above for why.
      return json({ error: 'Google Tasks is not connected.', notConnected: true });
    }
    console.error('google-tasks-send failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Could not send this to Google Tasks.' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
