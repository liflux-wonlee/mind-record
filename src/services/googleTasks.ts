import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';

// Idempotent -- src/lib/oauth.ts also calls this at module load for the
// login OAuth flow, but that module isn't guaranteed to have been
// imported (and therefore run) before this one, so this flow calls it
// again here rather than relying on that.
WebBrowser.maybeCompleteAuthSession();

export type GoogleTasksSendRecord = { googleTaskId: string; listTitle: string | null; sentAt: string };

/** Whether this task/idea was already sent (and to what), straight from
 *  google_tasks_sends -- the app's own RLS-readable send-history table,
 *  no Edge Function needed for a plain read like this. */
export async function getGoogleTasksSendRecord(
  itemType: 'task' | 'memory',
  itemId: string
): Promise<GoogleTasksSendRecord | null> {
  const { data, error } = await supabase
    .from('google_tasks_sends')
    .select('google_task_id, google_task_list_title, sent_at')
    .eq(itemType === 'task' ? 'task_id' : 'memory_id', itemId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { googleTaskId: data.google_task_id, listTitle: data.google_task_list_title, sentAt: data.sent_at };
}

export type GoogleTasksStatus = {
  connected: boolean;
  email: string | null;
  defaultListId: string | null;
  defaultListTitle: string | null;
};

export type GoogleTaskList = { id: string; title: string };

export class GoogleTasksCancelledError extends Error {
  constructor() {
    super('Connecting Google Tasks was cancelled.');
    this.name = 'GoogleTasksCancelledError';
  }
}

/**
 * Connects Google Tasks -- entirely separate from login's Google Sign-In
 * (src/services/auth.ts), with its own consent screen and its own tokens
 * (see supabase/functions/google-tasks-connect-start/callback). Available
 * no matter which provider the user actually signed into Mind Record
 * with.
 */
export async function connectGoogleTasks(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('google-tasks-connect-start');
  if (error) throw await describeFunctionError(error, 'Could not start connecting Google Tasks.');
  const { authUrl } = data as { authUrl: string };

  const redirectTo = Linking.createURL('/google-tasks/callback');
  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectTo);

  if (result.type === 'success') {
    const url = new URL(result.url);
    const status = url.searchParams.get('status');
    if (status === 'connected') return;
    const message = url.searchParams.get('message');
    if (message === 'cancelled') throw new GoogleTasksCancelledError();
    throw new Error(message ? `Could not connect Google Tasks (${message}).` : 'Could not connect Google Tasks.');
  }

  // On Android, the final mindrecord:// redirect sometimes goes straight to
  // the OS instead of back to this browser session (same quirk src/lib/
  // oauth.ts documents for Apple's Android login path) -- the connection
  // may have completed on the server a moment after this promise settles,
  // so check before reporting a false cancellation.
  if (await waitForConnected()) return;
  throw new GoogleTasksCancelledError();
}

async function waitForConnected(timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await getGoogleTasksStatus();
      if (status.connected) return true;
    } catch {
      // Keep polling until the timeout instead of failing on one bad request.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

export async function getGoogleTasksStatus(): Promise<GoogleTasksStatus> {
  const { data, error } = await supabase.functions.invoke('google-tasks-status');
  if (error) throw await describeFunctionError(error, 'Could not check Google Tasks connection.');
  return data as GoogleTasksStatus;
}

export async function listGoogleTaskLists(): Promise<GoogleTaskList[]> {
  const { data, error } = await supabase.functions.invoke('google-tasks-lists');
  if (error) throw await describeFunctionError(error, 'Could not load your Google Tasks lists.');
  const result = data as { lists?: GoogleTaskList[]; error?: string; notConnected?: boolean };
  if (result.error) {
    const e = new Error(result.error);
    if (result.notConnected) e.name = 'NotConnectedError';
    throw e;
  }
  return result.lists ?? [];
}

export async function setDefaultGoogleTaskList(listId: string, listTitle: string): Promise<void> {
  const { error } = await supabase.functions.invoke('google-tasks-set-default-list', {
    body: { listId, listTitle },
  });
  if (error) throw await describeFunctionError(error, 'Could not save your default list.');
}

export async function disconnectGoogleTasks(): Promise<void> {
  const { error } = await supabase.functions.invoke('google-tasks-disconnect');
  if (error) throw await describeFunctionError(error, 'Could not disconnect Google Tasks.');
}

export type SendGoogleTasksResult = { status: 'sent' | 'already_sent'; googleTaskId: string; listId: string };

/**
 * Sends one task or idea to Google Tasks -- only ever called from that
 * item's own menu/an explicit user action, never automatically. Throws a
 * distinguishable error (`notConnected`/`needsList`) so the caller can
 * prompt to connect/pick a list instead of showing a generic failure.
 */
export async function sendToGoogleTasks(
  itemType: 'task' | 'memory',
  itemId: string,
  listId?: string
): Promise<SendGoogleTasksResult> {
  const { data, error } = await supabase.functions.invoke('google-tasks-send', {
    body: { itemType, itemId, listId },
  });
  if (error) {
    const described = await describeFunctionError(error, 'Could not send this to Google Tasks.');
    throw described;
  }
  const result = data as SendGoogleTasksResult & { error?: string; notConnected?: boolean; needsList?: boolean };
  if (result.error) {
    const e = new Error(result.error);
    if (result.notConnected) e.name = 'NotConnectedError';
    if (result.needsList) e.name = 'NeedsListError';
    throw e;
  }
  return result;
}
