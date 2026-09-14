import { supabase } from '@/lib/supabase';
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
