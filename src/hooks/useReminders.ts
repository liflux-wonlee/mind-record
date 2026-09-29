/**
 * Screen-level state shared by Home's reminders card, the Reminders list and
 * the reminder settings: the live agenda (refetched on focus) and this
 * phone's notification permission (re-read on focus and when the app comes
 * back from the system Settings).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { friendlyMessage } from '@/lib/friendlyError';
import { getPushState, PUSH_SUPPORTED, turnOnNotifications, type PushState } from '@/lib/push';
import { useAuth } from '@/providers/AuthProvider';
import { getAgenda, type AgendaItem } from '@/services/reminders';

type AgendaState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: AgendaItem[] };

export function useAgenda() {
  const { user } = useAuth();
  const [state, setState] = useState<AgendaState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const id = ++loadIdRef.current;
    try {
      const items = await getAgenda(user.id);
      if (id === loadIdRef.current) setState({ status: 'ready', items });
    } catch (e) {
      if (id !== loadIdRef.current) return;
      // Keep showing what we had rather than blanking the list.
      setState((prev) =>
        prev.status === 'ready' ? prev : { status: 'error', message: friendlyMessage(e, 'Could not load reminders.') }
      );
    }
  }, [user]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const items = state.status === 'ready' ? state.items : [];
  return {
    state,
    items,
    now: items.filter((i) => i.bucket === 'now'),
    later: items.filter((i) => i.bucket === 'later'),
    context: items.filter((i) => i.bucket === 'context'),
    refresh: load,
    refreshing,
    pullToRefresh,
  };
}

export function usePushPermission() {
  const [push, setPush] = useState<PushState | null>(null);

  const refresh = useCallback(() => {
    if (!PUSH_SUPPORTED) return;
    getPushState()
      .then(setPush)
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // Coming back from the system Settings app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const turnOn = useCallback(async () => {
    const next = await turnOnNotifications().catch(() => null);
    if (next) setPush(next);
    return next;
  }, []);

  return {
    supported: PUSH_SUPPORTED,
    push,
    granted: push?.permission === 'granted',
    refresh,
    turnOn,
  };
}
