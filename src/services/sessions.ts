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
