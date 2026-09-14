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
