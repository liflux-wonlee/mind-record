import { supabase } from '@/lib/supabase';
import type { Database, SessionMode } from '@/types/database';

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
