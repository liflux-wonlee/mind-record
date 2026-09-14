import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/**
 * Kicks off the `process-session` Edge Function (transcribe + AI extraction
 * -- see supabase/functions/process-session) for a just-ended session. The
 * function updates `sessions.processing_status` as it goes; callers poll
 * that (see app/summary.tsx) rather than awaiting this for a result, since
 * transcription + analysis can take well longer than feels good to block a
 * screen transition on.
 */
export async function processSession(sessionId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('process-session', {
    body: { sessionId },
  });
  if (error) throw await describeFunctionError(error);
}

/**
 * supabase-js's FunctionsHttpError.message is just the generic "Edge
 * Function returned a non-2xx status code" -- the Edge Function's own
 * JSON error body (`{ error: "..." }`, see supabase/functions/
 * process-session/index.ts's `json()` helper) is on `error.context`, a
 * Response object that has to be read separately or it's silently lost.
 */
async function describeFunctionError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') return new Error(body.error);
    } catch {
      // Response body wasn't JSON (or already consumed) -- fall through.
    }
  }
  return error instanceof Error ? error : new Error('Could not process this recording.');
}
