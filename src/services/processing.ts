import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';
import { deviceTimeZone } from '@/lib/device';

/**
 * Kicks off the `process-session` Edge Function (transcribe + AI extraction
 * -- see supabase/functions/process-session) for a just-ended session. The
 * function updates `sessions.processing_status` as it goes; callers poll
 * that (see app/summary.tsx) rather than awaiting this for a result, since
 * transcription + analysis can take well longer than feels good to block a
 * screen transition on. The device timezone tells it which day relative
 * dates ("내일까지") were spoken on.
 */
export async function processSession(sessionId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('process-session', {
    body: { sessionId, timezone: deviceTimeZone() },
  });
  if (error) throw await describeFunctionError(error, 'Could not process this recording.');
}
