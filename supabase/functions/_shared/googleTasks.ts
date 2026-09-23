// Shared by every google-tasks-* Edge Function: the token-refresh helper
// and the small set of Google endpoints they all call. Not shared with
// login's Google Sign-In (src/services/auth.ts's signInWithGoogle) at all
// -- that's a completely separate OAuth client/token, on purpose (the spec
// is explicit that a Google Tasks connection must never reuse the login
// ID token, and must survive independently of which provider the user
// actually signed into Mind Record with).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export const GOOGLE_TASKS_CLIENT_ID = Deno.env.get('GOOGLE_TASKS_CLIENT_ID');

// Every Google call is bounded: converse makes these mid-turn, inside its
// own time budget, and a hung request must not hold a voice reply hostage.
// A caller can also pass an overall `signal` (converse's turn deadline)
// that cuts a whole multi-call send short.
const GOOGLE_TIMEOUT_MS = 10_000;

function callSignal(signal?: AbortSignal): AbortSignal {
  const perCall = AbortSignal.timeout(GOOGLE_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, perCall]) : perCall;
}
export const GOOGLE_TASKS_CLIENT_SECRET = Deno.env.get('GOOGLE_TASKS_CLIENT_SECRET');

export type GoogleTasksConnection = {
  user_id: string;
  google_sub: string;
  google_email: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  default_list_id: string | null;
  default_list_title: string | null;
};

/**
 * Returns a live access token for this user's Google Tasks connection,
 * refreshing it first if it's missing or within a minute of expiring.
 * Throws NotConnectedError if there's no connection row at all.
 */
export async function getValidAccessToken(
  db: SupabaseClient,
  userId: string,
  signal?: AbortSignal
): Promise<{ accessToken: string; connection: GoogleTasksConnection }> {
  const { data: connection, error } = await db
    .from('google_tasks_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!connection) throw new NotConnectedError();

  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt - Date.now() > 60_000) {
    return { accessToken: connection.access_token, connection };
  }

  if (!GOOGLE_TASKS_CLIENT_ID || !GOOGLE_TASKS_CLIENT_SECRET) {
    throw new Error('Google Tasks is not configured on this project.');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_TASKS_CLIENT_ID,
      client_secret: GOOGLE_TASKS_CLIENT_SECRET,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
    signal: callSignal(signal),
  });
  if (!res.ok) {
    const body = await res.text();
    // A revoked/expired refresh token (permission revoked in the user's
    // Google account, or the grant expired) surfaces here as invalid_grant
    // -- treat it as "disconnected", not a generic server error, so the
    // app can prompt to reconnect instead of just showing "try again".
    if (res.status === 400 && /invalid_grant/i.test(body)) throw new NotConnectedError();
    // The raw Google response body is logged, not shown -- it's Google's
    // own OAuth error JSON, not something a user should ever see.
    console.error('Google Tasks token refresh failed:', res.status, body);
    throw new Error('Could not refresh the Google Tasks connection. Please try again.');
  }
  const data = await res.json();
  const accessToken = data.access_token as string;
  const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  const newExpiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

  const { error: updateError } = await db
    .from('google_tasks_connections')
    .update({ access_token: accessToken, access_token_expires_at: newExpiresAt })
    .eq('user_id', userId);
  if (updateError) throw updateError;

  return { accessToken, connection: { ...connection, access_token: accessToken, access_token_expires_at: newExpiresAt } };
}

export class NotConnectedError extends Error {
  constructor() {
    super('Google Tasks is not connected.');
    this.name = 'NotConnectedError';
  }
}

export async function googleTasksFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  return fetch(`https://tasks.googleapis.com/tasks/v1/${path}`, {
    ...init,
    signal: init?.signal ?? callSignal(signal),
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
}

// ── sending (shared by google-tasks-send and converse's voice tools) ────

export type GoogleTaskList = { id: string; title: string };

/** Every one of the user's Google Tasks lists (the API pages them, 100 at most per page). */
export async function fetchGoogleTaskLists(accessToken: string, signal?: AbortSignal): Promise<GoogleTaskList[]> {
  const lists: GoogleTaskList[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ maxResults: '100' });
    if (pageToken) query.set('pageToken', pageToken);
    const res = await googleTasksFetch(accessToken, `users/@me/lists?${query}`, undefined, signal);
    if (!res.ok) {
      console.error('Google Tasks API (lists) failed:', res.status, await res.text());
      throw new Error('Could not load your Google Tasks lists.');
    }
    const data = await res.json();
    for (const l of data.items ?? []) {
      if (typeof l?.id === 'string') lists.push({ id: l.id, title: typeof l.title === 'string' ? l.title : '' });
    }
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : undefined;
    if (!pageToken) break;
  }
  return lists;
}

/** A task that isn't in any app list, and no default Google list has been chosen yet. */
export class NeedsListError extends Error {
  constructor() {
    super('Choose a default Google Tasks list first (Account -> Google Tasks), or put this task in one of your lists.');
    this.name = 'NeedsListError';
  }
}

/** The Google list the user picked for an app list is gone (deleted in Google). */
export class MappedListMissingError extends Error {
  constructor(appListName: string) {
    super(`The Google Tasks list chosen for "${appListName}" no longer exists. Pick another one in Tasks (long-press the list).`);
    this.name = 'MappedListMissingError';
  }
}

export class ItemNotFoundError extends Error {
  constructor() {
    super('That item no longer exists.');
    this.name = 'ItemNotFoundError';
  }
}

export type GoogleSendResult = {
  status: 'sent' | 'already_sent';
  googleTaskId: string;
  listId: string;
  listTitle: string | null;
  /** A Google list was created for this send (automatic same-name mapping). */
  createdList: boolean;
};

function sameListTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

type Target = { id: string; title: string | null; createdList: boolean; manualFor: string | null };

/**
 * Which Google list a task goes to: an explicit `listId`; else, for a task
 * in one of the app's lists, the Google list chosen for it, or -- by
 * default -- the Google list with the same name, created if missing; else
 * the default list from Account -> Google Tasks.
 */
async function resolveTarget(
  db: SupabaseClient,
  userId: string,
  accessToken: string,
  connection: GoogleTasksConnection,
  appListId: string | null,
  explicitListId: string | undefined,
  signal: AbortSignal | undefined
): Promise<Target> {
  if (explicitListId) {
    const title = explicitListId === connection.default_list_id ? connection.default_list_title : null;
    return { id: explicitListId, title, createdList: false, manualFor: null };
  }
  if (appListId) {
    const { data: appList, error } = await db
      .from('task_lists')
      .select('id, name, google_task_list_id, google_task_list_title')
      .eq('id', appListId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (appList) {
      if (appList.google_task_list_id) {
        return {
          id: appList.google_task_list_id,
          title: appList.google_task_list_title ?? null,
          createdList: false,
          manualFor: appList.name,
        };
      }
      const lists = await fetchGoogleTaskLists(accessToken, signal);
      const match = lists.find((l) => sameListTitle(l.title, appList.name));
      if (match) return { id: match.id, title: match.title, createdList: false, manualFor: null };
      const res = await googleTasksFetch(accessToken, 'users/@me/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: appList.name }),
      }, signal);
      if (!res.ok) {
        console.error('Google Tasks API (create list) failed:', res.status, await res.text());
        throw new Error('Could not create the list in Google Tasks.');
      }
      const created = await res.json();
      return { id: created.id as string, title: (created.title as string) ?? appList.name, createdList: true, manualFor: null };
    }
  }
  if (!connection.default_list_id) throw new NeedsListError();
  return { id: connection.default_list_id, title: connection.default_list_title, createdList: false, manualFor: null };
}

export type GoogleSendItem =
  | { kind: 'task'; id: string }
  | { kind: 'memory'; id: string };

/**
 * Sends one task or idea to Google Tasks, never more than once per Google
 * list: google_tasks_sends has a unique constraint per (item, list), so a
 * repeat returns the existing send. Only ever called for an explicit user
 * action -- a tap on Send, or asking for it by voice.
 */
export async function sendToGoogleTasks(
  db: SupabaseClient,
  userId: string,
  item: GoogleSendItem,
  opts: { listId?: string; signal?: AbortSignal } = {}
): Promise<GoogleSendResult> {
  let title: string;
  let notes: string | null;
  let due: string | undefined;
  let appListId: string | null = null;
  if (item.kind === 'task') {
    const { data: task, error } = await db
      .from('tasks')
      .select('id, title, description, due_date, list_id')
      .eq('id', item.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!task) throw new ItemNotFoundError();
    title = task.title;
    notes = task.description;
    // Google Tasks' `due` keeps only the date -- the time part is ignored
    // by the API, so this never implies a time was set.
    due = task.due_date ? `${task.due_date}T00:00:00.000Z` : undefined;
    appListId = task.list_id;
  } else {
    const { data: memory, error } = await db
      .from('memories')
      .select('id, content')
      .eq('id', item.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!memory) throw new ItemNotFoundError();
    title = memory.content.length > 200 ? `${memory.content.slice(0, 199)}…` : memory.content;
    notes = memory.content.length > 200 ? memory.content : null;
  }
  const itemColumn = item.kind === 'task' ? 'task_id' : 'memory_id';

  const { accessToken, connection } = await getValidAccessToken(db, userId, opts.signal);
  const target = await resolveTarget(db, userId, accessToken, connection, appListId, opts.listId, opts.signal);

  const { data: existing, error: existingError } = await db
    .from('google_tasks_sends')
    .select('google_task_id, google_task_list_title')
    .eq(itemColumn, item.id)
    .eq('google_task_list_id', target.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    return {
      status: 'already_sent',
      googleTaskId: existing.google_task_id,
      listId: target.id,
      listTitle: existing.google_task_list_title ?? target.title,
      createdList: target.createdList,
    };
  }

  const res = await googleTasksFetch(accessToken, `lists/${encodeURIComponent(target.id)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, notes: notes ?? undefined, due }),
  }, opts.signal);
  if (!res.ok) {
    const body = await res.text();
    if ((res.status === 404 || res.status === 400) && target.manualFor !== null) throw new MappedListMissingError(target.manualFor);
    console.error('Google Tasks API (send) failed:', res.status, body);
    throw new Error('Could not send this to Google Tasks.');
  }
  const created = await res.json();
  const googleTaskId = created.id as string;

  const { error: insertError } = await db.from('google_tasks_sends').insert({
    user_id: userId,
    [itemColumn]: item.id,
    google_task_list_id: target.id,
    google_task_list_title: target.title,
    google_task_id: googleTaskId,
  });
  const taskUrl = `lists/${encodeURIComponent(target.id)}/tasks/${encodeURIComponent(googleTaskId)}`;
  if (insertError) {
    if (insertError.code !== '23505') {
      // Without its send record this copy could never be undone, and a
      // retry would add a second one -- take it back out of Google.
      await googleTasksFetch(accessToken, taskUrl, { method: 'DELETE' }).catch((e) =>
        console.error('Google Tasks rollback failed:', e instanceof Error ? e.message : '')
      );
      throw insertError;
    }
    // A concurrent send of the same item to the same list (a double-tap)
    // recorded itself first -- remove the duplicate this call just created
    // in Google and report the recorded one.
    await googleTasksFetch(accessToken, taskUrl, { method: 'DELETE' }).catch(() => undefined);
    const { data: winner } = await db
      .from('google_tasks_sends')
      .select('google_task_id')
      .eq(itemColumn, item.id)
      .eq('google_task_list_id', target.id)
      .maybeSingle();
    return {
      status: 'already_sent',
      googleTaskId: (winner?.google_task_id as string | undefined) ?? googleTaskId,
      listId: target.id,
      listTitle: target.title,
      createdList: target.createdList,
    };
  }
  return { status: 'sent', googleTaskId, listId: target.id, listTitle: target.title, createdList: target.createdList };
}

export type GoogleSendRef = { google_task_list_id: string; google_task_id: string };

/**
 * Deletes these sent tasks from Google Tasks (undo), and Mind Record's own
 * record of each send. A task already gone from Google counts as removed.
 * Never throws for Google-side trouble -- reports what couldn't be removed.
 */
export async function deleteFromGoogleTasks(
  db: SupabaseClient,
  userId: string,
  sends: GoogleSendRef[],
  /** removeListsIfEmpty: Google lists created for these sends -- removed too, if nothing is left in them. */
  opts: { removeListsIfEmpty?: string[]; signal?: AbortSignal } = {}
): Promise<{ removed: number; failed: number; notConnected: boolean }> {
  if (sends.length === 0) return { removed: 0, failed: 0, notConnected: false };
  let accessToken: string;
  try {
    ({ accessToken } = await getValidAccessToken(db, userId, opts.signal));
  } catch (e) {
    if (e instanceof NotConnectedError) return { removed: 0, failed: sends.length, notConnected: true };
    console.error('Google Tasks delete: no access token:', e instanceof Error ? e.message : '');
    return { removed: 0, failed: sends.length, notConnected: false };
  }
  let removed = 0;
  let failed = 0;
  for (const send of sends) {
    try {
      const res = await googleTasksFetch(
        accessToken,
        `lists/${encodeURIComponent(send.google_task_list_id)}/tasks/${encodeURIComponent(send.google_task_id)}`,
        { method: 'DELETE' },
        opts.signal
      );
      if (res.ok || res.status === 404 || res.status === 410) {
        removed++;
        const { error } = await db
          .from('google_tasks_sends')
          .delete()
          .eq('user_id', userId)
          .eq('google_task_list_id', send.google_task_list_id)
          .eq('google_task_id', send.google_task_id);
        if (error) console.error('Google Tasks delete: could not remove the send record:', error.code ?? '', error.message ?? '');
      } else {
        failed++;
        console.error('Google Tasks API (delete) failed:', res.status, await res.text());
      }
    } catch (e) {
      failed++;
      console.error('Google Tasks API (delete) failed:', e instanceof Error ? e.message : '');
    }
  }
  for (const listId of new Set(opts.removeListsIfEmpty ?? [])) {
    try {
      const query = new URLSearchParams({ maxResults: '1', showCompleted: 'true', showHidden: 'true', showDeleted: 'false' });
      const res = await googleTasksFetch(accessToken, `lists/${encodeURIComponent(listId)}/tasks?${query}`, undefined, opts.signal);
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) continue;
      const del = await googleTasksFetch(accessToken, `users/@me/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' }, opts.signal);
      if (!del.ok && del.status !== 404) console.error('Google Tasks API (delete list) failed:', del.status, await del.text());
    } catch (e) {
      console.error('Google Tasks API (delete list) failed:', e instanceof Error ? e.message : '');
    }
  }
  return { removed, failed, notConnected: false };
}
