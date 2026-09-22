import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';
import { appendFilePart } from '@/services/recordings';

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
  /** What the AI actually did in the app this turn (task added, topic filed, ...), for on-screen confirmation chips. */
  actions?: ConverseAction[];
};

export type ConverseAction = { type: string; label: string };

/**
 * Sends one turn's audio to the `converse` Edge Function: it transcribes
 * the segment, replies using the session's full message history for
 * context, and synthesizes the reply as speech.
 *
 * `audio: { uri, mimeType }` sends the segment directly as multipart
 * (`FormData`, RN's `{ uri, name, type }` file part -- streamed from disk
 * by the native layer, never loaded into a JS string) so the function can
 * start transcribing without a round trip to Storage and back first -- see
 * src/lib/featureFlags.ts. A giant base64 string inlined into a JSON body
 * was tried first and turned out to fail outright on-device (the request
 * never reached Supabase at all -- see git history) before ever reaching
 * this multipart version; `storagePath` is the original flow, for a
 * recording too large to inline or with the flag off (an attachment
 * already uploaded via src/services/recordings.ts's uploadRecording).
 */
/** The device's IANA timezone (e.g. "America/New_York") -- converse needs it to know what "today" means for the user. */
function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export async function converseTurn(
  sessionId: string,
  audio: { storagePath: string } | { uri: string; mimeType: string },
  turnId?: string
): Promise<ConverseResult> {
  const timezone = deviceTimeZone();
  let body: FormData | { sessionId: string; storagePath: string; turnId?: string; timezone?: string };
  if ('storagePath' in audio) {
    body = { sessionId, storagePath: audio.storagePath, turnId, timezone };
  } else {
    const form = new FormData();
    form.append('sessionId', sessionId);
    if (turnId) form.append('turnId', turnId);
    if (timezone) form.append('timezone', timezone);
    await appendFilePart(form, 'audio', audio.uri, 'segment.m4a', audio.mimeType);
    body = form;
  }
  const { data, error } = await supabase.functions.invoke('converse', { body });
  if (error) throw await describeFunctionError(error, 'Could not reach the AI.');
  return data as ConverseResult;
}
