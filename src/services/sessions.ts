import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type Session = Database['public']['Tables']['sessions']['Row'];

/**
 * Home's "Continue conversation" list — the foundation for reading real
 * session/journal records. There's no capture pipeline writing to
 * `sessions` yet (that's a later phase), so for a new project this
 * correctly, honestly returns an empty list rather than inventing rows.
 */
export async function listRecentSessions(userId: string, limit = 5): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
