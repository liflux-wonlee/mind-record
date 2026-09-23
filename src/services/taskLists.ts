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

/**
 * Which Google Tasks list this list's tasks are sent to: a specific one, or
 * `null` for automatic -- the Google list with the same name, created in
 * Google on first send if missing (see supabase/functions/_shared/googleTasks.ts).
 */
export async function setTaskListGoogleList(
  listId: string,
  googleList: { id: string; title: string } | null
): Promise<TaskList> {
  const { data, error } = await supabase
    .from('task_lists')
    .update({ google_task_list_id: googleList?.id ?? null, google_task_list_title: googleList?.title ?? null })
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
