import { supabase } from '@/lib/supabase';
import type { Database, SessionMode, SessionOutlineSection } from '@/types/database';

export type Session = Database['public']['Tables']['sessions']['Row'];

/**
 * Home's "Continue conversation" list — reads whatever real sessions exist.
 * Sessions are created by `createSession` below, from an actual recording
 * (see src/hooks/useCaptureSession.ts) — there's still no transcript/AI
 * pipeline filling in `title`/`summary`, so those stay null until that
 * later phase.
 */
export async function listRecentSessions(userId: string, limit = 5): Promise<Session[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/** Sessions started on the given local calendar day. */
export async function listSessionsForDay(userId: string, date: Date): Promise<Session[]> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('started_at', start.toISOString())
    .lte('started_at', end.toISOString())
    .order('started_at', { ascending: true });
  if (error) throw error;
  return data;
}

/** Sessions started anywhere in the given local calendar month (0-indexed, like Date's `getMonth()`). */
export async function listSessionsInMonth(userId: string, year: number, month: number): Promise<Session[]> {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .gte('started_at', start.toISOString())
    .lte('started_at', end.toISOString())
    .order('started_at', { ascending: true });
  if (error) throw error;
  return data;
}

export type SessionsPageCursor = { startedAt: string; id: string };

/**
 * Records' List view -- pages through EVERY session, oldest never falling
 * out of reach the way Home's `listRecentSessions`/`listSessionsInMonth`
 * top out. `before` is a composite (started_at, id) cursor, not a bare
 * offset or a `started_at`-only cursor -- two sessions can share the same
 * `started_at` (rapid recordings, or any future bulk-insert path), and a
 * plain `lt('started_at', ...)` cursor would then drop every row exactly
 * equal to the last one loaded from every later page instead of just the
 * ones already shown. Ordering and filtering by (started_at, id) together
 * keeps the sequence stable across pages regardless of ties.
 */
export async function listSessionsPage(
  userId: string,
  { before, limit = 20 }: { before?: SessionsPageCursor; limit?: number } = {}
): Promise<Session[]> {
  let query = supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before) {
    query = query.or(`started_at.lt.${before.startedAt},and(started_at.eq.${before.startedAt},id.lt.${before.id})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSession(userId: string, mode: SessionMode): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ user_id: userId, mode })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function endSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
}

/** Corrects the AI-written summary -- a typo, a misheard word, or
 *  something worth adding that the transcription missed. Summary's
 *  long-press-to-edit is the only place this is called from. */
export async function updateSessionSummary(sessionId: string, summary: string): Promise<void> {
  const { error } = await supabase.from('sessions').update({ summary }).eq('id', sessionId);
  if (error) throw error;
}

/** Replaces the full `outline` array -- used both to edit one section's
 *  heading/bullets and to remove a section entirely (Summary's
 *  long-press-to-edit on an outline section). */
export async function updateSessionOutline(sessionId: string, outline: SessionOutlineSection[]): Promise<void> {
  const { error } = await supabase.from('sessions').update({ outline }).eq('id', sessionId);
  if (error) throw error;
}

/**
 * Deletes a session -- for a failed/errored recording, or one stopped too
 * fast to matter. Removes the actual audio files from Storage first (the
 * `attachments` rows cascade-delete with the session automatically, but
 * that never deletes the underlying Storage object, which would otherwise
 * leak orphaned files). tasks/memories that came from this session are
 * kept, just with source_session_id cleared (`on delete set null`) --
 * deleting a recording shouldn't delete the task it produced.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const { data: attachments, error: attachmentsError } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('session_id', sessionId);
  if (attachmentsError) throw attachmentsError;

  if (attachments && attachments.length > 0) {
    const { error: removeError } = await supabase.storage
      .from('recordings')
      .remove(attachments.map((a) => a.storage_path));
    if (removeError) throw removeError;
  }

  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}
