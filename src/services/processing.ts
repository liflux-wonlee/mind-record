import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';
import { deviceTimeZone } from '@/lib/device';
import { flushPendingUploads, pendingSessionIds } from '@/services/pendingUploads';

/** A long recording takes a few server runs; more than this means something is wrong. */
const MAX_RUNS = 12;

/**
 * Kicks off the `process-session` Edge Function (transcribe + AI extraction
 * -- see supabase/functions/process-session) for a just-ended session. The
 * function updates `sessions.processing_status` as it goes; callers poll
 * that (see app/summary.tsx) rather than awaiting this for a result, since
 * transcription + analysis can take well longer than feels good to block a
 * screen transition on. The device timezone tells it which day relative
 * dates ("내일까지") were spoken on.
 *
 * Any of this session's audio still waiting on the phone (an upload that
 * failed) goes up first. A long recording is processed over several server
 * runs (each is limited to 150 s): while the function answers 'continue',
 * this calls it again -- it picks up from the first segment not yet
 * transcribed.
 */
export async function processSession(sessionId: string): Promise<void> {
  const left = await flushPendingUploads(sessionId);
  if (left > 0) {
    throw new Error(
      'Part of this recording is still on your phone and could not be uploaded yet. Check your connection and tap Retry.'
    );
  }
  for (let run = 0; run < MAX_RUNS; run++) {
    const { data, error } = await supabase.functions.invoke('process-session', {
      body: { sessionId, timezone: deviceTimeZone() },
    });
    if (error) throw await describeFunctionError(error, 'Could not process this recording.');
    if ((data as { status?: string } | null)?.status !== 'continue') return;
  }
}

/**
 * On app start: sends any recording parts still waiting on the phone and
 * processes their sessions (a no-op for a session that's already done).
 */
export async function resumePendingSessions(): Promise<void> {
  for (const sessionId of await pendingSessionIds()) {
    await processSession(sessionId).catch(() => {
      // Still offline -- the next start (or Summary's Retry) tries again.
    });
  }
}
