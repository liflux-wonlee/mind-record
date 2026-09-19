import { supabase } from '@/lib/supabase';

export type SearchHit = {
  kind: 'session' | 'task' | 'memory';
  id: string;
  title: string;
  snippet: string | null;
  happened_at: string;
  session_id: string | null;
  topic_id: string | null;
};

/** Full search over every recording (incl. transcript), task and idea --
 *  see supabase/migrations/20260919000001_search.sql. */
export async function searchEverything(query: string, maxResults = 60): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase.rpc('search_everything', { q, max_results: maxResults });
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}
