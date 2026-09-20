/**
 * Loads the signed-in user's tasks from Supabase and refetches whenever the
 * screen that uses this hook regains focus (e.g. coming back from another
 * tab), so a task created or completed elsewhere shows up without a manual
 * pull-to-refresh.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import { createTask, deleteTask, listTasks, setTaskStatus, updateTask, type Task } from '@/services/tasks';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tasks: Task[] };

export function useTasks() {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!user) return;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      const tasks = await listTasks(user.id);
      setState({ status: 'ready', tasks });
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
    async (title: string, dueDate?: string | null) => {
      if (!user) return;
      const created = await createTask(user.id, { title, dueDate });
      setState((prev) => (prev.status === 'ready' ? { status: 'ready', tasks: [created, ...prev.tasks] } : prev));
    },
    [user]
  );

  const toggle = useCallback(async (task: Task) => {
    const nextStatus = task.status === 'completed' ? 'open' : 'completed';
    const updated = await setTaskStatus(task.id, nextStatus);
    setState((prev) =>
      prev.status === 'ready'
        ? { status: 'ready', tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) }
        : prev
    );
  }, []);

  const update = useCallback(
    async (task: Task, input: { title?: string; dueDate?: string | null }) => {
      const updated = await updateTask(task.id, input);
      setState((prev) =>
        prev.status === 'ready'
          ? { status: 'ready', tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)) }
          : prev
      );
    },
    []
  );

  const remove = useCallback(async (task: Task) => {
    await deleteTask(task.id);
    setState((prev) =>
      prev.status === 'ready' ? { status: 'ready', tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev
    );
  }, []);

  return {
    ...state,
    refresh: load,
    add,
    toggle,
    update,
    remove,
    openCount: state.status === 'ready' ? state.tasks.filter((t) => t.status === 'open').length : 0,
  };
}
