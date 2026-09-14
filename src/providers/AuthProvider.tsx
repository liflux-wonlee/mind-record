/**
 * Auth state — wraps the whole app so any screen can read who's signed in,
 * and so `app/_layout.tsx` can redirect between `/login` and the app based
 * on it. See `src/services/auth.ts` for the actions that change this state
 * (sign in/up/out); this provider only *observes* Supabase's session.
 */
import type { Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { processAuthDeepLink } from '@/lib/authLinking';
import { supabase } from '@/lib/supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  /** True until the very first `getSession()` call resolves. */
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // Email confirmation / magic link / password recovery links open the app
  // via a deep link rather than an in-app browser session (see
  // src/lib/authLinking.ts for why this needs its own listener).
  useEffect(() => {
    const handleUrl = (url: string) => {
      processAuthDeepLink(url).then((result) => {
        if (result.status === 'error') {
          Alert.alert('Sign-in link problem', result.message);
        }
      });
    };

    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);

  const value = useMemo<AuthState>(
    () => ({ session, user: session?.user ?? null, loading }),
    [session, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
