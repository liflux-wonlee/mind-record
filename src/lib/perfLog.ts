/**
 * Latency instrumentation for the two "speak and hear the AI back" loops
 * (Talk's Conversation mode, Search's voice question) -- see
 * useConversationSession.ts / useVoiceSearch.ts for the actual marks.
 *
 * This is a development/diagnostic tool, not a product feature: it prints
 * one structured JSON line per turn to the console (visible via `adb
 * logcat` or the Metro/dev-client console), tagged with a `turnId` shared
 * with the matching server-side log line (see
 * supabase/functions/_shared/perf.ts) so the two can be correlated by grep
 * during a real-device test session. It never touches user content --
 * only stage names and millisecond offsets.
 *
 * `performance.now()` is used where available (a monotonic clock, per the
 * measurement rules this was built against) with a `Date.now()` fallback
 * for any environment where it's missing -- Hermes has supported it since
 * well before this app's RN version, so the fallback should be dead code
 * in practice, not a silent accuracy downgrade.
 */
const perfNow: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

export function newTurnId(): string {
  // crypto.randomUUID() is already used elsewhere in this codebase
  // (src/services/auth.ts) via expo-crypto; globalThis.crypto.randomUUID
  // is polyfilled by the same dependency, so no extra import is needed here.
  return globalThis.crypto?.randomUUID?.() ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type PerfMark = { name: string; t: number };

/** One turn's running list of marks -- create with startPerfTurn(), add
 *  marks with .mark(name), and print the summary with .finish(extra). */
export class PerfTurn {
  readonly turnId: string;
  readonly tag: string;
  private readonly marks: PerfMark[] = [];
  private readonly t0: number;

  constructor(tag: string, turnId: string = newTurnId()) {
    this.tag = tag;
    this.turnId = turnId;
    this.t0 = perfNow();
    this.marks.push({ name: 'start', t: this.t0 });
  }

  /** Records a stage boundary. Call this at the moment each stage actually
   *  completes (or begins), not from inside a .then() queued later. */
  mark(name: string): void {
    this.marks.push({ name, t: perfNow() });
  }

  /** Elapsed ms from turn start to a given mark, or to now if the mark was
   *  never recorded (e.g. the turn errored before reaching it). */
  private elapsedTo(name: string): number | null {
    const m = this.marks.find((x) => x.name === name);
    return m ? Math.round(m.t - this.t0) : null;
  }

  /** Prints the turn's timeline as one JSON line and returns the same
   *  summary object, in case a caller wants to keep it (e.g. to show a
   *  dev-only overlay later). `extra` is for non-timing context (which
   *  path was taken, byte sizes, error info) -- never raw transcript or
   *  answer text. */
  finish(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const stages = this.marks
      .slice(1)
      .map((m, i) => ({ name: m.name, sinceStartMs: Math.round(m.t - this.t0), sincePrevMs: Math.round(m.t - this.marks[i].t) }));
    const summary = {
      tag: this.tag,
      turnId: this.turnId,
      totalMs: Math.round(perfNow() - this.t0),
      stages,
      ...extra,
    };
    // eslint-disable-next-line no-console
    console.log(`[perf:${this.tag}]`, JSON.stringify(summary));
    return summary;
  }

  /** Convenience for the headline number this whole effort is about: time
   *  from the turn actually starting (recording began) to the reply audio
   *  first reaching the native player -- NOT the same as "audible to a
   *  human", which this app has no way to verify without an external mic.
   *  Returns null if either mark is missing (e.g. the turn errored). */
  msFrom(startMark: string, endMark: string): number | null {
    const a = this.elapsedTo(startMark);
    const b = this.elapsedTo(endMark);
    return a === null || b === null ? null : b - a;
  }
}

export function startPerfTurn(tag: string, turnId?: string): PerfTurn {
  return new PerfTurn(tag, turnId);
}
