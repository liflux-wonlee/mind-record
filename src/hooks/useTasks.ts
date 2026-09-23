/**
 * Loads the signed-in user's tasks (and task lists) from Supabase and
 * refetches whenever the screen that uses this hook regains focus (e.g.
 * coming back from another tab), so a task created or completed elsewhere
 * shows up without a manual pull-to-refresh.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import {
  createTaskList,
  deleteTaskList,
  listTaskLists,
  renameTaskList,
  setTaskListGoogleList,
  type TaskList,
} from '@/services/taskLists';
import {
  assignTaskList,
  clearTaskList,
  createTask,
  deleteTask,
  listTasks,
  setTaskStarred,
  setTaskStatus,
  updateTask,
  type Task,
} from '@/services/tasks';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tasks: Task[]; lists: TaskList[] };

export function useTasks() {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!user) return;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      const [tasks, lists] = await Promise.all([listTasks(user.id), listTaskLists(user.id)]);
      setState({ status: 'ready', tasks, lists });
    } catch (e) {
      setState({ status: 'error', message: friendlyMessage(e, 'Failed to load tasks.') });
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const add = useCallback(
    async (title: string, dueDate?: string | null, listId?: string | null) => {
      if (!user) return;
      const created = await createTask(user.id, { title, dueDate, listId });
      setState((prev) => (prev.status === 'ready' ? { ...prev, tasks: [created, ...prev.tasks] } : prev));
      return created;
    },
    [user]
  );

  const toggle = useCallback(async (task: Task) => {
    const nextStatus = task.status === 'completed' ? 'open' : 'completed';
    const updated = await setTaskStatus(task.id, nextStatus);
    setState((prev) =>
      prev.status === 'ready' ? { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) } : prev
    );
  }, []);

  const update = useCallback(
    async (task: Task, input: { title?: string; description?: string | null; dueDate?: string | null }) => {
      const updated = await updateTask(task.id, input);
      setState((prev) =>
        prev.status === 'ready' ? { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) } : prev
      );
    },
    []
  );

  const remove = useCallback(async (task: Task) => {
    await deleteTask(task.id);
    setState((prev) => (prev.status === 'ready' ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev));
  }, []);

  const toggleStar = useCallback(async (task: Task) => {
    const updated = await setTaskStarred(task.id, !task.starred);
    setState((prev) =>
      prev.status === 'ready' ? { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) } : prev
    );
  }, []);

  const moveToList = useCallback(async (task: Task, listId: string) => {
    const updated = await assignTaskList(task.id, listId);
    setState((prev) =>
      prev.status === 'ready' ? { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) } : prev
    );
  }, []);

  const removeFromList = useCallback(async (task: Task) => {
    const updated = await clearTaskList(task.id);
    setState((prev) =>
      prev.status === 'ready' ? { ...prev, tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) } : prev
    );
  }, []);

  const addList = useCallback(
    async (name: string) => {
      if (!user) return;
      const created = await createTaskList(user.id, name);
      setState((prev) =>
        prev.status === 'ready'
          ? { ...prev, lists: [...prev.lists, created].sort((a, b) => a.name.localeCompare(b.name)) }
          : prev
      );
      return created;
    },
    [user]
  );

  const renameList = useCallback(async (list: TaskList, name: string) => {
    const updated = await renameTaskList(list.id, name);
    setState((prev) =>
      prev.status === 'ready'
        ? {
            ...prev,
            lists: prev.lists.map((l) => (l.id === updated.id ? updated : l)).sort((a, b) => a.name.localeCompare(b.name)),
          }
        : prev
    );
  }, []);

  const setListGoogleList = useCallback(async (list: TaskList, googleList: { id: string; title: string } | null) => {
    const updated = await setTaskListGoogleList(list.id, googleList);
    setState((prev) =>
      prev.status === 'ready' ? { ...prev, lists: prev.lists.map((l) => (l.id === updated.id ? updated : l)) } : prev
    );
    return updated;
  }, []);

  const removeList = useCallback(async (list: TaskList) => {
    await deleteTaskList(list.id);
    setState((prev) =>
      prev.status === 'ready'
        ? {
            ...prev,
            lists: prev.lists.filter((l) => l.id !== list.id),
            tasks: prev.tasks.map((t) => (t.list_id === list.id ? { ...t, list_id: null } : t)),
          }
        : prev
    );
  }, []);

  return {
    ...state,
    refresh: load,
    add,
    toggle,
    update,
    remove,
    toggleStar,
    moveToList,
    removeFromList,
    addList,
    renameList,
    setListGoogleList,
    removeList,
    openCount: state.status === 'ready' ? state.tasks.filter((t) => t.status === 'open').length : 0,
  };
}
