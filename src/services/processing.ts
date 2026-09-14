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
  if (error) throw error;
}
