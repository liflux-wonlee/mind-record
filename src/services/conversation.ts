import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';

export type ConverseResult = {
  /** What Whisper heard for this turn -- empty if nothing intelligible was captured. */
  userText: string;
  assistantText: string;
  /** True when the user just told the AI, in plain speech, to end and save right now. */
  shouldEnd: boolean;
  /** Base64-encoded mp3 of `assistantText`, spoken via OpenAI TTS. */
  audioBase64: string;
};

/**
 * Sends one turn's audio (already uploaded to the `recordings` bucket, see
 * src/services/recordings.ts) to the `converse` Edge Function: it
 * transcribes the segment, replies using the session's full message
 * history for context, and synthesizes the reply as speech.
 */
export async function converseTurn(sessionId: string, storagePath: string): Promise<ConverseResult> {
  const { data, error } = await supabase.functions.invoke('converse', {
    body: { sessionId, storagePath },
  });
  if (error) throw await describeFunctionError(error, 'Could not reach the AI.');
  return data as ConverseResult;
}
