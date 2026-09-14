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
