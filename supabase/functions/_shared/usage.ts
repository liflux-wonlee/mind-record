// Usage measurement foundation (§11) -- shared by every Edge Function that
// spends real OpenAI usage (process-session, converse, search-ask,
// preview-voice). Pure record-keeping: this never checks or enforces any
// limit, and nothing about a plan/entitlement lives here -- it only writes
// to `usage_events`, which has no client-facing write policy at all (see
// its migration).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

export type UsageEventType = 'transcribe' | 'gpt_completion' | 'tts_synthesize';
export type UsageSource = 'process_session' | 'converse' | 'search_ask' | 'preview_voice';

export type UsageEvent = {
  userId: string;
  eventType: UsageEventType;
  source: UsageSource;
  sessionId?: string | null;
  /** See the migration's own comment -- only pass this for an operation that
   *  can legitimately be re-run as "the same" attempt (currently: process-
   *  session's per-session transcribe/analyze steps). Leave undefined for
   *  anything else. */
  dedupeKey?: string;
  audioSeconds?: number;
  audioBytes?: number;
  inputTokens?: number;
  outputTokens?: number;
  ttsCharacters?: number;
  /** The OpenAI model used, when it isn't the function's usual one (e.g. TTS voices on gpt-4o-mini-tts). */
  model?: string;
  succeeded?: boolean;
  errorMessage?: string;
};

/**
 * Best-effort by design: a usage-logging failure must never take down the
 * actual user-facing operation it's measuring. Logs to the function's own
 * console on failure rather than throwing, so a transient DB hiccup here
 * costs a missing usage row, not a failed transcription/reply.
 */
export async function recordUsage(db: SupabaseClient, event: UsageEvent): Promise<void> {
  try {
    const row = {
      user_id: event.userId,
      event_type: event.eventType,
      source: event.source,
      session_id: event.sessionId ?? null,
      dedupe_key: event.dedupeKey ?? null,
      audio_seconds: event.audioSeconds ?? null,
      audio_bytes: event.audioBytes ?? null,
      input_tokens: event.inputTokens ?? null,
      output_tokens: event.outputTokens ?? null,
      tts_characters: event.ttsCharacters ?? null,
      succeeded: event.succeeded ?? true,
      error_message: event.errorMessage ?? null,
      // Only when set, so an insert still works before the column's
      // migration (20260927000002_usage_events_model.sql) is applied.
      ...(event.model ? { model: event.model } : {}),
    };
    if (event.dedupeKey) {
      const { error } = await db.from('usage_events').upsert(row, { onConflict: 'dedupe_key' });
      if (error) throw error;
    } else {
      const { error } = await db.from('usage_events').insert(row);
      if (error) throw error;
    }
  } catch (e) {
    console.warn('recordUsage failed (non-fatal):', event.eventType, event.source, e);
  }
}
