// The Conversation-mode action log: one `messages` row (role 'system',
// tagged with the turn's client_turn_id) per change the voice assistant made
// in the app -- written by converse/tools.ts, read back by converse (prompt
// context, undo) and by process-session (so saving the conversation
// respects what was done or undone live). Clients can't insert role 'system'
// rows (see 20260924000001_converse_turns.sql).

export const ACTION_PREFIX = '[action] ';
/** Marks that a turn ended the conversation, so a replayed turn can say so too. */
export const TURN_END_MARKER = '[turn-end]';

export type ActionRecord = {
  v: 1;
  type: 'task_created' | 'topic_filed' | 'topic_created';
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
