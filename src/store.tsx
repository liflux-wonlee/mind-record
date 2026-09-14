/**
 * App state — the prototype's `this.state`, lifted into a context so the same
 * session survives navigation between routes.
 *
 * Everything left here is still local/in-memory UI state on purpose: Inbox
 * review choices and the Calendar's selected day are prototype-only
 * interaction state, not data that belongs in the database. What *was* here
 * and has since moved out: tasks — now `src/hooks/useTasks.ts`; the capture
 * session (recording/timer/mode) — now `src/hooks/useCaptureSession.ts`,
 * backed by a real microphone recording instead of a fake timer, and kept
 * local to the Talk/Driving screens rather than shared context since
 * nothing else needs to read it.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { inboxItems } from '@/data';

type AppState = {
  /* inbox */
  inboxResolved: Record<number, string>;
  resolveInbox: (i: number, choice: string) => void;
  inboxCount: number;

  /* calendar */
  selectedDay: number;
  setSelectedDay: (d: number) => void;

  /* account */
  prefs: Record<string, boolean>;
  togglePref: (key: string, current: boolean) => void;
};

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [inboxResolved, setInboxResolved] = useState<Record<number, string>>({});
  const [selectedDay, setSelectedDay] = useState(11);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  const resolveInbox = useCallback((i: number, choice: string) => {
    setInboxResolved((prev) => ({ ...prev, [i]: choice }));
  }, []);

  const togglePref = useCallback((key: string, current: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: !current }));
  }, []);

  const value = useMemo<AppState>(
    () => ({
      inboxResolved,
      resolveInbox,
      inboxCount: inboxItems.filter((it, i) => it.review && !inboxResolved[i]).length,
      selectedDay,
      setSelectedDay,
      prefs,
      togglePref,
    }),
    [inboxResolved, resolveInbox, selectedDay, prefs, togglePref]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
