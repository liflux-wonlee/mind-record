/**
 * Auth state — wraps the whole app so any screen can read who's signed in,
 * and so `app/_layout.tsx` can redirect between `/login` and the app based
 * on it. See `src/services/auth.ts` for the actions that change this state
 * (sign in/up/out); this provider only *observes* Supabase's session.
 */
import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

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
