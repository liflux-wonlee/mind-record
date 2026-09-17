/**
 * App state — the prototype's `this.state`, lifted into a context so the same
 * session survives navigation between routes.
 *
 * Everything left here is still local/in-memory UI state on purpose. What
 * *was* here and has since moved out: tasks — now `src/hooks/useTasks.ts`;
 * the capture session (recording/timer/mode) — now
 * `src/hooks/useCaptureSession.ts`, backed by a real microphone recording
 * instead of a fake timer; Inbox's review queue — now backed by real
 * pending topic suggestions (see `app/(tabs)/inbox.tsx`,
 * `src/services/tasks.ts`/`memories.ts`) instead of this context's local
 * resolved/count state; Records' selected day — now local state in
 * `app/(tabs)/calendar.tsx` itself, since it now has to track a
 * navigable month alongside it rather than one fixed "today".
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type AppState = {
  /* account */
  prefs: Record<string, boolean>;
  togglePref: (key: string, current: boolean) => void;
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  const togglePref = useCallback((key: string, current: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: !current }));
  }, []);

  const value = useMemo<AppState>(
    () => ({
      prefs,
      togglePref,
    }),
    [prefs, togglePref]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
