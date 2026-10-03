/**
 * What the app is waiting on from Supabase right now, and how long recent
 * requests took -- shown on Account -> Connection check so a slow screen can
 * be traced to the exact request holding things up. Records only the
 * endpoint (path and query parameter names), never values or bodies.
 */
type Entry = { id: number; method: string; endpoint: string; start: number };
export type Finished = { method: string; endpoint: string; ms: number; outcome: string; at: number };

const inFlight = new Map<number, Entry>();
const recent: Finished[] = [];
const MAX_RECENT = 80;
let nextId = 1;

function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    const keys = [...new Set([...u.searchParams.keys()])];
    return keys.length ? `${u.pathname}?${keys.join('&')}` : u.pathname;
  } catch {
    return url.split('?')[0];
  }
}

export function requestStarted(method: string, url: string): number {
  const id = nextId++;
  inFlight.set(id, { id, method, endpoint: endpointOf(url), start: Date.now() });
  return id;
}

export function requestFinished(id: number, outcome: string): void {
  const e = inFlight.get(id);
  if (!e) return;
  inFlight.delete(id);
  recent.push({ method: e.method, endpoint: e.endpoint, ms: Date.now() - e.start, outcome, at: Date.now() });
  if (recent.length > MAX_RECENT) recent.shift();
}

export function snapshot(): { inFlight: (Entry & { ms: number })[]; slowest: Finished[] } {
  const now = Date.now();
  return {
    inFlight: [...inFlight.values()].map((e) => ({ ...e, ms: now - e.start })).sort((a, b) => b.ms - a.ms),
    slowest: [...recent].sort((a, b) => b.ms - a.ms).slice(0, 12),
  };
}
