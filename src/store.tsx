/**
 * App state — the prototype's `this.state`, lifted into a context so the same
 * session survives navigation between routes.
 *
 * Everything here is local and in-memory: the handoff is screens + navigation
 * only, so there is no persistence or backend behind it yet.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { inboxItems, tasks } from '@/data';

type CaptureMode = 'capture' | 'conv';
type RelatedState = null | 'linked' | 'dismissed';

type AppState = {
  /* capture session */
  mode: CaptureMode;
  setMode: (m: CaptureMode) => void;
  recording: boolean;
  seconds: number;
  /** True once the user has recorded at least one segment this session. */
  everRecorded: boolean;
  saveOnly: boolean;
  toggleSaveOnly: () => void;
  related: RelatedState;
  setRelated: (r: RelatedState) => void;
  /** Starts a fresh session (resets timer, transcript and AI suggestions). */
  startSession: () => void;
  /** Starts recording, or stops it. Returns true when stopping — the caller
   *  then navigates to the post-capture summary, as the prototype does. */
  toggleRecording: () => boolean;
  stopRecording: () => void;
  /** Number of transcript lines revealed so far (0–3). */
  lines: number;
  timer: string;

  /* tasks */
  tasksDone: boolean[];
  toggleTask: (i: number) => void;
  openTaskCount: number;

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
  const [mode, setMode] = useState<CaptureMode>('capture');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [everRecorded, setEverRecorded] = useState(false);
  const [saveOnly, setSaveOnly] = useState(false);
  const [related, setRelated] = useState<RelatedState>(null);
  const [tasksDone, setTasksDone] = useState<boolean[]>(() => tasks.map(() => false));
  const [inboxResolved, setInboxResolved] = useState<Record<number, string>>({});
  const [selectedDay, setSelectedDay] = useState(11);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  // The prototype ticks a 1s interval and only advances while recording.
  const recordingRef = useRef(false);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);
  useEffect(() => {
    const id = setInterval(() => {
      if (recordingRef.current) setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const startSession = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
    setSeconds(0);
    setEverRecorded(false);
    setRelated(null);
  }, []);

  const toggleRecording = useCallback(() => {
    const wasRecording = recordingRef.current;
    recordingRef.current = !wasRecording;
    setRecording(!wasRecording);
    if (!wasRecording) {
      setSeconds(0);
      setEverRecorded(true);
    }
    return wasRecording;
  }, []);

  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    setRecording(false);
  }, []);

  const toggleTask = useCallback((i: number) => {
    setTasksDone((prev) => prev.map((d, j) => (j === i ? !d : d)));
  }, []);

  const resolveInbox = useCallback((i: number, choice: string) => {
    setInboxResolved((prev) => ({ ...prev, [i]: choice }));
  }, []);

  const togglePref = useCallback((key: string, current: boolean) => {
    setPrefs((prev) => ({ ...prev, [key]: !current }));
  }, []);

  const value = useMemo<AppState>(() => {
    const lines = recording || everRecorded ? Math.min(3, Math.floor(seconds / 3)) : 0;
    return {
      mode,
      setMode,
      recording,
      seconds,
      everRecorded,
      saveOnly,
      toggleSaveOnly: () => setSaveOnly((s) => !s),
      related,
      setRelated,
      startSession,
      toggleRecording,
      stopRecording,
      lines,
      timer: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      tasksDone,
      toggleTask,
      openTaskCount: tasksDone.filter((d) => !d).length,
      inboxResolved,
      resolveInbox,
      inboxCount: inboxItems.filter((it, i) => it.review && !inboxResolved[i]).length,
      selectedDay,
      setSelectedDay,
      prefs,
      togglePref,
    };
  }, [
    mode,
    recording,
    seconds,
    everRecorded,
    saveOnly,
    related,
    startSession,
    toggleRecording,
    stopRecording,
    tasksDone,
    toggleTask,
    inboxResolved,
    resolveInbox,
    selectedDay,
    prefs,
    togglePref,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
