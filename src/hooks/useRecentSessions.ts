/**
 * Home's "Continue conversation" foundation — reads real session rows.
 * There's no capture pipeline writing to `sessions` yet, so a fresh account
 * correctly sees an empty list rather than the old hardcoded JoaSuite/
 * Liflux/Faith rows.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { friendlyMessage } from '@/lib/friendlyError';
import { useAuth } from '@/providers/AuthProvider';
import { listRecentSessions, type Session } from '@/services/sessions';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sessions: Session[] };

export function useRecentSessions(limit = 5) {
  const { user } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!user) return;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    try {
      const sessions = await listRecentSessions(user.id, limit);
      setState({ status: 'ready', sessions });
    } catch (e) {
      setState({
        status: 'error',
        message: friendlyMessage(e, 'Failed to load recent sessions.'),
      });
    }
  }, [user, limit]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return { ...state, refresh: load };
}
