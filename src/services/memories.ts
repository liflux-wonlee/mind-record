import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Memory = Database['public']['Tables']['memories']['Row'];

export async function listMemoriesBySession(sessionId: string): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('source_session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function listMemoriesCreatedInRange(
  userId: string,
  startIso: string,
  endIso: string
): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/** Recent memories regardless of date -- used for a plain "recent ideas" list. */
export async function listRecentMemories(userId: string, limit = 10): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Ideas the AI extracted but wasn't confident enough about to file under a topic on its own. */
export async function listMemoriesPendingTopicReview(userId: string): Promise<Memory[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('*')
    .eq('user_id', userId)
    .is('topic_id', null)
    .not('topic_suggestion', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/** Confirms a memory's AI-suggested topic (or a different one the user picked instead). */
export async function assignMemoryTopic(memoryId: string, topicId: string): Promise<Memory> {
  const { data, error } = await supabase
    .from('memories')
    .update({ topic_id: topicId, topic_suggestion: null })
    .eq('id', memoryId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
