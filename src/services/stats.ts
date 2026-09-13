import { supabase } from '@/lib/supabase';

export type AccountStats = {
  entries: number;
  days: number;
  topics: number;
};

/** Powers Account's three usage tiles — real counts, not the old hardcoded 312/48/9. */
export async function getAccountStats(userId: string): Promise<AccountStats> {
  const [sessionsRes, topicsRes, datesRes] = await Promise.all([
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('topics').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('sessions').select('started_at').eq('user_id', userId),
  ]);
  if (sessionsRes.error) throw sessionsRes.error;
  if (topicsRes.error) throw topicsRes.error;
  if (datesRes.error) throw datesRes.error;

  const distinctDays = new Set(
    (datesRes.data ?? []).map((row) => new Date(row.started_at).toDateString())
  );

  return {
    entries: sessionsRes.count ?? 0,
    days: distinctDays.size,
    topics: topicsRes.count ?? 0,
  };
}
