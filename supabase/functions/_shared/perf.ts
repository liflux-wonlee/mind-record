// Server-side counterpart of src/lib/perfLog.ts -- see that file's header
// for the overall shape (one structured JSON line per turn, correlated by
// turnId with the client's own log line). `console.log` here lands in
// `supabase functions logs <name>`, which is where a real measurement pass
// reads it from.
//
// Deno's `performance.now()` is monotonic within a single function
// invocation, which is all this needs -- it is NOT compared against the
// client's clock (see the measurement rules this was built against: never
// subtract two different devices' clocks to infer network time).

export type PerfMark = { name: string; t: number };

export class PerfTurn {
  readonly turnId: string;
  readonly tag: string;
  private readonly marks: PerfMark[] = [];
  private readonly t0: number;

  constructor(tag: string, turnId: string) {
    this.tag = tag;
    this.turnId = turnId;
    this.t0 = performance.now();
    this.marks.push({ name: 'start', t: this.t0 });
  }

  mark(name: string): void {
    this.marks.push({ name, t: performance.now() });
  }

  finish(extra: Record<string, unknown> = {}): void {
    const stages = this.marks
      .slice(1)
      .map((m, i) => ({ name: m.name, sinceStartMs: Math.round(m.t - this.t0), sincePrevMs: Math.round(m.t - this.marks[i].t) }));
    const summary = {
      tag: this.tag,
      turnId: this.turnId,
      totalMs: Math.round(performance.now() - this.t0),
      stages,
      ...extra,
    };
    console.log(`[perf:${this.tag}]`, JSON.stringify(summary));
  }
}

/**
 * Schedules `tasks` (already-started promises, e.g. deferred recordUsage/
 * cleanup calls) plus a final callback to run after the response has been
 * returned, via the Edge Runtime's documented background-task API
 * (https://supabase.com/docs/guides/functions/background-tasks) --
 * without this, work started after `return` has no guarantee of finishing
 * before the isolate is torn down. Falls back to a plain fire-and-forget
 * if that API isn't present in a given deployment context (never seen
 * locally, since this can only run on Supabase's own infrastructure)
 * rather than silently dropping the work.
 */
export function scheduleBackground(tasks: Promise<unknown>[], onDone?: () => void): void {
  const all = Promise.all(tasks).then(
    () => onDone?.(),
    () => onDone?.()
  );
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(all);
  } else {
    all.catch(() => {});
  }
}
