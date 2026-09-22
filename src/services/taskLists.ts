import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type TaskList = Database['public']['Tables']['task_lists']['Row'];

/** A user's task lists, flat (there is no nesting, unlike topics). */
export async function listTaskLists(userId: string): Promise<TaskList[]> {
  const { data, error } = await supabase
    .from('task_lists')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createTaskList(userId: string, name: string): Promise<TaskList> {
  const { data, error } = await supabase
    .from('task_lists')
    .insert({ user_id: userId, name: name.trim() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function renameTaskList(listId: string, name: string): Promise<TaskList> {
  const { data, error } = await supabase
    .from('task_lists')
    .update({ name: name.trim() })
    .eq('id', listId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Tasks under this list keep their content, just unfiled (list_id set null) -- same convention as deleteTopic. */
export async function deleteTaskList(listId: string): Promise<void> {
  const { error } = await supabase.from('task_lists').delete().eq('id', listId);
  if (error) throw error;
}

/**
 * Resolves an AI `list_suggestion` string to a real list -- reuses a
 * matching existing one (case-insensitive) or creates it. Mirrors
 * src/services/topics.ts's confirmTopicSuggestion.
 */
export async function confirmListSuggestion(userId: string, lists: TaskList[], suggestion: string): Promise<TaskList> {
  const existing = lists.find((l) => l.name.toLowerCase() === suggestion.toLowerCase());
  return existing ?? createTaskList(userId, suggestion);
}
