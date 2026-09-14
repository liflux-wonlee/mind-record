import { supabase } from '@/lib/supabase';
import type { Database, TaskStatus } from '@/types/database';

export type Task = Database['public']['Tables']['tasks']['Row'];

export async function listTasks(userId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listTasksBySession(sessionId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('source_session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTask(
  userId: string,
  input: { title: string; dueDate?: string | null }
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ user_id: userId, title: input.title, due_date: input.dueDate ?? null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Confirms a task's AI-suggested topic (or a different one the user picked instead). */
export async function assignTaskTopic(taskId: string, topicId: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ topic_id: topicId, topic_suggestion: null })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
