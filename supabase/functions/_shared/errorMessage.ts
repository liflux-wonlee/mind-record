/**
 * Shared translation from a caught error to safe, user-facing text -- used
 * by every Edge Function's top-level (and DB-call) catch sites so a raw
 * OpenAI/Postgres/network error never reaches the client verbatim (e.g. a
 * raw Postgres constraint/RLS message, or an OpenAI rate-limit error body).
 * Unlike each function's earlier local copy of this, an UNMATCHED error
 * never falls back to the raw message -- it always returns `fallback`. The
 * real error should still be `console.error`-logged at the call site for
 * server-side debugging; this function only controls what the user sees.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const raw =
    e instanceof Error
      ? e.message
      : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
        ? (e as { message: string }).message
        : '';

  // A handful of messages we write ourselves elsewhere in these functions
  // are already user-facing -- pass those through as-is.
  if (/too large to transcribe/.test(raw)) return raw;

  if (/^Whisper transcription failed/.test(raw)) return whisperMessage(raw);
  if (/^The uploaded audio/.test(raw)) return raw;
  if (/^AI (analysis|reply|interpretation|answer) failed/.test(raw) || /returned no content/.test(raw)) {
    return "The AI couldn't respond just now. Please try again.";
  }
  if (/^Speech synthesis failed/.test(raw)) return "Couldn't generate the voice reply. Please try again.";
  if (/fetch failed|network|ECONNRESET|timed? ?out/i.test(raw)) return 'Connection problem. Please try again.';
  if (/violates|constraint|duplicate key|null value|permission denied|row-level security/i.test(raw)) {
    return "Couldn't save that right now. Please try again.";
  }
  if (/rate.?limit|429|quota/i.test(raw)) return 'Too many requests right now. Please wait a moment and try again.';

  return fallback;
}

/**
 * Whisper failures say which kind they were (OpenAI's own short reason, e.g.
 * "Invalid file format" or a quota error), so a recording that keeps failing
 * can be told apart from a passing hiccup -- no transcript or user content
 * is in these messages.
 */
function whisperMessage(raw: string): string {
  const status = /\((\d{3})\)/.exec(raw)?.[1];
  let reason = '';
  const body = raw.slice(raw.indexOf(':') + 1).trim();
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.error?.message === 'string') reason = parsed.error.message;
  } catch {
    // not JSON
  }
  reason = reason.replace(/\s+/g, ' ').slice(0, 140);
  const detail = [status ? `OpenAI ${status}` : null, reason || null].filter(Boolean).join(': ');
  return `Couldn't transcribe the audio${detail ? ` (${detail})` : ''}. Tap Retry; if it keeps failing, play the original on this screen to check it was recorded.`;
}
