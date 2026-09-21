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
  /** Echoed back from the request for perf-log correlation (see src/lib/perfLog.ts). */
  turnId?: string;
};

/**
 * Sends one turn's audio to the `converse` Edge Function: it transcribes
 * the segment, replies using the session's full message history for
 * context, and synthesizes the reply as speech.
 *
 * `audio` carries the segment directly (see src/lib/featureFlags.ts) so the
 * function can start transcribing without a round trip to Storage and
 * back first; `storagePath` is the original flow, for a recording too
 * large to inline or with the flag off (an attachment already uploaded via
 * src/services/recordings.ts's uploadRecording).
 */
export async function converseTurn(
  sessionId: string,
  audio: { storagePath: string } | { audioBase64: string; mimeType: string },
  turnId?: string
): Promise<ConverseResult> {
  const body =
    'storagePath' in audio
      ? { sessionId, storagePath: audio.storagePath, turnId }
      : { sessionId, audioBase64: audio.audioBase64, mimeType: audio.mimeType, turnId };
  const { data, error } = await supabase.functions.invoke('converse', { body });
  if (error) throw await describeFunctionError(error, 'Could not reach the AI.');
  return data as ConverseResult;
}
