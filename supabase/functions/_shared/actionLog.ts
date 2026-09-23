// The Conversation-mode action log: one `messages` row (role 'system',
// tagged with the turn's client_turn_id) per change the voice assistant made
// in the app -- written by converse/tools.ts, read back by converse (prompt
// context, undo) and by process-session (so saving the conversation
// respects what was done or undone live). Clients can't insert role 'system'
// rows (see 20260924000001_converse_turns.sql).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export const ACTION_PREFIX = '[action] ';
/**
 * Written just BEFORE a turn's assistant row (so once the assistant row
 * exists, this is already there): whether the turn ended the conversation,
 * and the confirmation chips it returned -- so a retried request can replay
 * the turn exactly.
 */
export const TURN_META_PREFIX = '[turn-meta] ';
/** Written as soon as an undo succeeds, tagged with the undoing turn -- a retry must not undo a second time. */
export const UNDO_PREFIX = '[undo] ';

export type TurnMeta = { v: 1; end: boolean; actions: { type: string; label: string; newTopic?: boolean }[] };
export type UndoRecord = {
  v: 1;
  turn_id: string;
  /** The confirmation chips it returned ("Undone: ..."). */
  labels: string[];
  /** What was said to confirm it -- so a turn that died right after can still be confirmed. */
  spoken?: { ko: string; en: string };
};

/** One task this action sent to Google Tasks. */
export type GoogleSendLog = {
  task_id: string;
  list_id: string;
  list_title: string | null;
  google_task_id: string;
  /** The Google list was created for this send (same-name mapping) -- undo removes it again if it's left empty. */
  created_list: boolean;
};

export type ActionRecord = {
  v: 1;
  type: 'task_created' | 'topic_filed' | 'topic_created' | 'google_sent';
  label: string;
  turn_id: string;
  /** The task title / topic display name ("Business · Liflux") this was about. */
  subject: string;
  task_ids: string[];
  /** Topics this action itself created -- deleted on undo only if nothing else uses them by then. */
  topic_ids: string[];
  /** Task lists this action itself created -- same rule. */
  list_ids: string[];
  /** The session_topics link this action added (null if it already existed). */
  linked_topic_id: string | null;
  /** google_sent only: what was sent. (Undoing a task_created removes every Google copy of its tasks, however they were sent.) */
  google_sends?: GoogleSendLog[];
  undone: boolean;
};

export function parseActionRecord(m: { role: string; content: string }): ActionRecord | null {
  if (m.role !== 'system' || !m.content.startsWith(ACTION_PREFIX)) return null;
  try {
    const parsed = JSON.parse(m.content.slice(ACTION_PREFIX.length));
    return parsed && parsed.v === 1 ? (parsed as ActionRecord) : null;
  } catch {
    return null;
  }
}

function parsePrefixed<T>(m: { role: string; content: string }, prefix: string): T | null {
  if (m.role !== 'system' || !m.content.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(m.content.slice(prefix.length));
    return parsed && parsed.v === 1 ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export function parseTurnMeta(m: { role: string; content: string }): TurnMeta | null {
  return parsePrefixed<TurnMeta>(m, TURN_META_PREFIX);
}

export function parseUndoRecord(m: { role: string; content: string }): UndoRecord | null {
  return parsePrefixed<UndoRecord>(m, UNDO_PREFIX);
}

export type MessageRow = {
  session_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  client_turn_id: string | null;
};

const TURN_ROLE_INDEX = 'messages_session_turn_role_idx';
const INSERT_ATTEMPTS = 3;

/**
 * Inserts one `messages` row and returns its id -- or 'duplicate' when this
 * turn already has a row of that role (the messages_session_turn_role_idx
 * unique index: another request for the same turn got there first).
 *
 * `position` is filled in by a trigger as max(position)+1, so two inserts
 * into the same session at the same moment can both pick the same number
 * and one fails on the (session_id, position) unique key -- that one is
 * simply retried.
 */
export async function insertMessageRow(db: SupabaseClient, row: MessageRow): Promise<{ id: string } | 'duplicate'> {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await db.from('messages').insert(row).select('id').single();
    if (!error && data) return { id: data.id as string };
    if (error?.code === '23505') {
      const text = `${error.message ?? ''} ${error.details ?? ''}`;
      if (text.includes(TURN_ROLE_INDEX)) return 'duplicate';
      if (attempt < INSERT_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 40)));
        continue;
      }
    }
    throw error ?? new Error('Could not save the message.');
  }
}
