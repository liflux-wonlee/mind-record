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

export async function listTasksCreatedInRange(userId: string, startIso: string, endIso: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/** Tasks the AI extracted but wasn't confident enough about to file under a topic on its own. */
export async function listTasksPendingTopicReview(userId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .is('topic_id', null)
    .not('topic_suggestion', 'is', null)
    .order('created_at', { ascending: false });
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

/** Tasks filed under any of these topics -- callers pass a topic plus its descendant ids to include sub-topics. */
export async function listTasksByTopics(topicIds: string[]): Promise<Task[]> {
  if (topicIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .in('topic_id', topicIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/** Tasks with no topic at all -- Topics' "Unclassified" view (absorbs the old standalone Inbox). */
export async function listTasksUnclassified(userId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .is('topic_id', null)
    .order('created_at', { ascending: false });
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

/** Removes this task from its topic -- the task itself is kept, just untagged. */
export async function clearTaskTopic(taskId: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ topic_id: null })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Edits a task's own fields -- title/description text, or its due date (pass `dueDate: null` to clear it). */
export async function updateTask(
  taskId: string,
  input: { title?: string; description?: string | null; dueDate?: string | null }
): Promise<Task> {
  const patch: Database['public']['Tables']['tasks']['Update'] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.dueDate !== undefined) patch.due_date = input.dueDate;
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', taskId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) throw error;
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
