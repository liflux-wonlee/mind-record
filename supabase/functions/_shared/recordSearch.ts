// Keyword search over a user's own records (recordings, tasks, ideas), shared
// by search-ask and converse's search_records tool.
//
// search_everything() (supabase/migrations/20260919000001_search.sql) matches
// its whole `q` as ONE contiguous ILIKE phrase, so a multi-word query like
// "에스더 축구" only found text containing exactly that phrase. This runs it
// once per keyword instead and merges the results, ranking rows that match
// more of the keywords first.
//
// Always call this with the CALLER's JWT-bound client, never the
// service-role one: search_everything is `security invoker`, so RLS is what
// keeps the results to the caller's own rows.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export type SearchHit = {
  kind: 'session' | 'task' | 'memory';
  id: string;
  title: string;
  snippet: string | null;
  happened_at: string;
  session_id: string | null;
  topic_id: string | null;
};

const MAX_KEYWORDS = 5;
const PER_KEYWORD_RESULTS = 60;

/** Splits free text / a keyword list into up to MAX_KEYWORDS distinct search terms. */
export function splitKeywords(raw: string | string[]): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((k) => String(k).split(/[\s,]+/));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const keyword = part.trim();
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

export async function searchRecords(
  callerClient: SupabaseClient,
  keywords: string[],
  opts: { dateFrom?: string | null; dateTo?: string | null; limit?: number } = {}
): Promise<SearchHit[]> {
  if (keywords.length === 0) return [];

  const perKeyword = await Promise.all(
    keywords.map(async (q) => {
      const { data, error } = await callerClient.rpc('search_everything', { q, max_results: PER_KEYWORD_RESULTS });
      if (error) throw error;
      return (data ?? []) as SearchHit[];
    })
  );

  const merged = new Map<string, { hit: SearchHit; matches: number }>();
  for (const hits of perKeyword) {
    for (const hit of hits) {
      const key = `${hit.kind}:${hit.id}`;
      const prev = merged.get(key);
      if (prev) prev.matches += 1;
      else merged.set(key, { hit, matches: 1 });
    }
  }

  let ranked = [...merged.values()];
  if (opts.dateFrom) ranked = ranked.filter((r) => r.hit.happened_at >= opts.dateFrom!);
  // happened_at is a full timestamp; dateTo is a bare date, so allow
  // through the end of that day rather than truncating it to midnight.
  if (opts.dateTo) ranked = ranked.filter((r) => r.hit.happened_at < `${opts.dateTo}T23:59:59.999Z`);

  ranked.sort((a, b) => {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.hit.happened_at < b.hit.happened_at ? 1 : a.hit.happened_at > b.hit.happened_at ? -1 : 0;
  });
  return ranked.slice(0, opts.limit ?? 25).map((r) => r.hit);
}

/** One line per hit, the format both search-ask and converse feed to the model. */
export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return '(no matching records)';
  return hits
    .map((h, i) => {
      const date = h.happened_at.slice(0, 10);
      const label = h.kind === 'session' ? 'Recording' : h.kind === 'task' ? 'Task' : 'Idea';
      return `${i + 1}. [${label}] ${date} -- ${h.title}${h.snippet && h.snippet !== h.title ? `: ${h.snippet}` : ''}`;
    })
    .join('\n');
}
