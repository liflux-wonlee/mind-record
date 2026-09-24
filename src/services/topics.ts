import { supabase } from '@/lib/supabase';
import type { Session, SessionsPageCursor } from '@/services/sessions';
import type { Database } from '@/types/database';

export type Topic = Database['public']['Tables']['topics']['Row'];

/**
 * Two plain queries instead of an embedded select (`session_topics(topics(name))`)
 * -- the hand-written Database type has empty `Relationships` on every table
 * (see src/types/database.ts), so an embedded select can't be typed properly
 * without fighting postgrest-js's generics. This is simple enough not to
 * need that.
 */
/** All of a user's topics, flat (with `parent_topic_id`) -- callers build a tree from it. */
export async function listTopics(userId: string): Promise<Topic[]> {
  const { data, error } = await supabase
    .from('topics')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTopic(
  userId: string,
  name: string,
  parentTopicId: string | null = null
): Promise<Topic> {
  const { data, error } = await supabase
    .from('topics')
    .insert({ user_id: userId, name: name.trim(), parent_topic_id: parentTopicId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameTopic(topicId: string, name: string): Promise<Topic> {
  const { data, error } = await supabase
    .from('topics')
    .update({ name: name.trim() })
    .eq('id', topicId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Re-parents a topic. The DB only rejects a topic being its OWN parent
 * (`topics_parent_not_self`) -- a deeper cycle (moving a topic under its
 * own child) has to be caught here instead, using the already-loaded flat
 * list rather than round-tripping to the DB to walk the tree.
 */
export function wouldCreateCycle(topics: Topic[], topicId: string, newParentId: string | null): boolean {
  let current = newParentId;
  while (current) {
    if (current === topicId) return true;
    current = topics.find((t) => t.id === current)?.parent_topic_id ?? null;
  }
  return false;
}

export async function moveTopic(topicId: string, newParentTopicId: string | null): Promise<Topic> {
  const { data, error } = await supabase
    .from('topics')
    .update({ parent_topic_id: newParentTopicId })
    .eq('id', topicId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Merges `sourceTopicId` into `targetTopicId` via the merge_topics() RPC
 * (see the topic-hierarchy migration) -- every task/memory/session link
 * tagged with the source moves to the target, any children of the source
 * are re-parented under the target, and the source topic is deleted. Runs
 * `security invoker` in Postgres, so RLS alone keeps this scoped to the
 * caller's own topics.
 */
export async function mergeTopics(sourceTopicId: string, targetTopicId: string): Promise<void> {
  const { error } = await supabase.rpc('merge_topics', {
    source_id: sourceTopicId,
    target_id: targetTopicId,
  });
  if (error) throw error;
}

/**
 * Resolves an AI `topic_suggestion` string to a real top-level topic --
 * reuses a matching existing one (case-insensitive) or creates it. Shared
 * by every "confirm this suggestion" flow (Summary, Inbox) so they can't
 * drift into different matching behavior.
 */
export async function confirmTopicSuggestion(
  userId: string,
  topics: Topic[],
  suggestion: string
): Promise<Topic> {
  const existing = topics.find(
    (t) => !t.parent_topic_id && t.name.toLowerCase() === suggestion.toLowerCase()
  );
  return existing ?? createTopic(userId, suggestion, null);
}

/** Tasks/memories tagged with this topic keep their content, just untagged (topic_id set null). */
export async function deleteTopic(topicId: string): Promise<void> {
  const { error } = await supabase.from('topics').delete().eq('id', topicId);
  if (error) throw error;
}

/**
 * Every id in the subtree rooted at `topicId` (itself included) -- used so
 * "include sub-topics" on Topics' detail view can query tasks/memories/
 * sessions across the whole branch in one shot, from the flat `topics`
 * list already loaded client-side (no need for a recursive DB query).
 */
export function descendantTopicIds(topics: Topic[], topicId: string): string[] {
  const ids = [topicId];
  const children = topics.filter((t) => t.parent_topic_id === topicId);
  for (const child of children) ids.push(...descendantTopicIds(topics, child.id));
  return ids;
}

/** Sessions tagged with any of these topics (via `session_topics`), most recent first. */
export async function listSessionsByTopics(topicIds: string[]): Promise<Session[]> {
  if (topicIds.length === 0) return [];
  const { data: links, error: linksError } = await supabase
    .from('session_topics')
    .select('session_id')
    .in('topic_id', topicIds);
  if (linksError) throw linksError;
  const sessionIds = [...new Set((links ?? []).map((l) => l.session_id))];
  if (sessionIds.length === 0) return [];

  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('*')
    .in('id', sessionIds)
    .order('started_at', { ascending: false });
  if (sessionsError) throw sessionsError;
  return sessions;
}

/**
 * Sessions with no `session_topics` link at all -- Topics' "Unclassified"
 * view. Real cursor-based pagination: a fixed cap here (there used to be
 * one at 200) would permanently hide any older unclassified session past
 * it, since "unclassified" isn't a column Postgrest can filter on directly
 * -- it has to fetch a batch of sessions, diff them against
 * `session_topics`, and keep going until it has found `limit` unclassified
 * ones or genuinely run out, rather than ever silently stopping at an
 * arbitrary recency cutoff. Bounded to a handful of round trips per call
 * (a user whose entire history happens to already be classified still
 * gets a fast, if page-less, response instead of this scanning their
 * whole account in one request) -- `nextCursor` says whether there's
 * plausibly more to look at.
 */
export async function listSessionsUnclassifiedPage(
  userId: string,
  { before, limit = 30 }: { before?: SessionsPageCursor; limit?: number } = {}
): Promise<{ sessions: Session[]; nextCursor: SessionsPageCursor | null }> {
  const BATCH_SIZE = 200;
  const MAX_BATCHES = 10;
  const collected: Session[] = [];
  let cursor = before ?? null;
  let exhausted = false;

  for (let i = 0; i < MAX_BATCHES && collected.length < limit; i++) {
    let query = supabase
      .from('sessions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(BATCH_SIZE);
    if (cursor) {
      query = query.or(`started_at.lt.${cursor.startedAt},and(started_at.eq.${cursor.startedAt},id.lt.${cursor.id})`);
    }
    const { data: batch, error } = await query;
    if (error) throw error;
    if (!batch || batch.length === 0) {
      exhausted = true;
      break;
    }

    const { data: links, error: linksError } = await supabase
      .from('session_topics')
      .select('session_id')
      .in(
        'session_id',
        batch.map((s) => s.id)
      );
    if (linksError) throw linksError;
    const classified = new Set((links ?? []).map((l) => l.session_id));
    for (const s of batch) {
      if (!classified.has(s.id)) collected.push(s);
    }

    const last = batch[batch.length - 1];
    cursor = { startedAt: last.started_at, id: last.id };
    if (batch.length < BATCH_SIZE) {
      exhausted = true;
      break;
    }
  }

  return { sessions: collected, nextCursor: exhausted ? null : cursor };
}

/**
 * Keeps `session_topics` in step after ONE topic assignment on Summary
 * changed (a section's, a task's or an idea's) -- a recording can cover
 * several topics, one per outline section. Adds a link for every topic in
 * `topicIds` (everything the recording's sections/tasks/ideas now use), and
 * removes `replacedTopicId`'s link -- the topic that assignment used to
 * hold -- only if nothing in `topicIds` still uses it and it isn't in
 * `keepTopicIds` (voice filings, when a task/idea changed -- see
 * listVoiceFiledTopicIds).
 *
 * Nothing else is removed: a link no section/task/idea holds can only have
 * come from filing the conversation under a topic by voice (converse's
 * file_under_topic), which an unrelated edit here must not undo.
 */
export async function syncSessionTopicLinks(
  sessionId: string,
  topicIds: string[],
  replacedTopicId: string | null,
  keepTopicIds?: Set<string>
): Promise<void> {
  const wanted = [...new Set(topicIds)];
  const { data: existing, error: existingError } = await supabase
    .from('session_topics')
    .select('topic_id')
    .eq('session_id', sessionId);
  if (existingError) throw existingError;
  const existingIds = new Set((existing ?? []).map((r) => r.topic_id));

  if (
    replacedTopicId &&
    existingIds.has(replacedTopicId) &&
    !wanted.includes(replacedTopicId) &&
    !keepTopicIds?.has(replacedTopicId)
  ) {
    const { error } = await supabase
      .from('session_topics')
      .delete()
      .eq('session_id', sessionId)
      .eq('topic_id', replacedTopicId);
    if (error) throw error;
  }

  const toAdd = wanted.filter((id) => !existingIds.has(id));
  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('session_topics')
      .insert(toAdd.map((topic_id) => ({ session_id: sessionId, topic_id })));
    if (error) throw error;
  }
}

/**
 * Topics this recording was filed under BY VOICE during a Conversation and
 * not undone -- read from converse's action log ('[action] ' system rows in
 * `messages`, see supabase/functions/_shared/actionLog.ts). An explicit
 * instruction for the whole recording: re-topicking one task or idea on
 * Summary must not remove it.
 */
export async function listVoiceFiledTopicIds(sessionId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('messages')
    .select('content')
    .eq('session_id', sessionId)
    .eq('role', 'system')
    .like('content', '[action] %');
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data ?? []) {
    try {
      const record = JSON.parse(row.content.slice('[action] '.length));
      if (record?.v !== 1 || record.type !== 'topic_filed' || record.undone) continue;
      const topicIds: unknown[] = Array.isArray(record.topic_ids) ? record.topic_ids : [];
      const id = record.linked_topic_id ?? topicIds[topicIds.length - 1];
      if (typeof id === 'string') ids.add(id);
    } catch {
      // Not a readable action record -- skip it.
    }
  }
  return ids;
}

/**
 * Moves a recording from one place in the topic tree to another ("Move
 * to…" on a topic's screen). `fromTopicIds` are the topics it's being
 * moved OUT of -- the topic being viewed (plus its sub-topics, when those
 * are shown), or empty from "Unclassified". Its outline sections filed
 * there are re-filed under `toTopicId` (from Unclassified: its unfiled
 * sections), so Summary shows the same thing, and its session_topics link
 * follows. Other topics it's also under are left alone, as are its tasks
 * and ideas (each has its own topic).
 */
export async function moveSessionToTopic(sessionId: string, fromTopicIds: string[], toTopicId: string): Promise<void> {
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('outline')
    .eq('id', sessionId)
    .single();
  if (sessionError) throw sessionError;

  const from = new Set(fromTopicIds);
  const fromUnclassified = from.size === 0;
  const outline = session.outline ?? [];
  let changed = false;
  const nextOutline = outline.map((section) => {
    const movesHere = section.topic_id ? from.has(section.topic_id) : fromUnclassified;
    if (!movesHere) return section;
    changed = true;
    return { ...section, topic_id: toTopicId, topic_suggestion: null };
  });
  if (changed) {
    const { error } = await supabase.from('sessions').update({ outline: nextOutline }).eq('id', sessionId);
    if (error) throw error;
  }

  const leaving = fromTopicIds.filter((id) => id !== toTopicId);
  if (leaving.length > 0) {
    const { error } = await supabase.from('session_topics').delete().eq('session_id', sessionId).in('topic_id', leaving);
    if (error) throw error;
  }
  const { error: linkError } = await supabase
    .from('session_topics')
    .upsert({ session_id: sessionId, topic_id: toTopicId }, { onConflict: 'session_id,topic_id', ignoreDuplicates: true });
  if (linkError) throw linkError;
}

export async function listSessionTopics(sessionId: string): Promise<Topic[]> {
  const { data: links, error: linksError } = await supabase
    .from('session_topics')
    .select('topic_id')
    .eq('session_id', sessionId);
  if (linksError) throw linksError;
  if (!links || links.length === 0) return [];

  const { data: topics, error: topicsError } = await supabase
    .from('topics')
    .select('*')
    .in(
      'id',
      links.map((l) => l.topic_id)
    );
  if (topicsError) throw topicsError;
  return topics;
}
