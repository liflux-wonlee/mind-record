/**
 * Reminders -- the app side of supabase/migrations/20260929000001_reminders.sql.
 *
 * The server owns every "when": reminder rules live in `reminders`, a DB
 * trigger keeps each one's next_fire_at, and reminders-dispatch sends the
 * pushes. The app only reads the agenda (the same RPC Home's count, the
 * Reminders list and the spoken briefing use), acts on targets through
 * reminder_act, and edits a task's rules. Nothing is scheduled on the
 * device, so a reminder is never sent twice by two delivery paths.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { deviceLanguage, deviceTimeZone } from '@/lib/device';
import { describeFunctionError } from '@/lib/functionsError';
import { supabase } from '@/lib/supabase';
import type {
  Database,
  ReminderAction,
  ReminderReason,
  ReminderTargetType,
  TaskRecurFreq,
} from '@/types/database';

export type AgendaItem = Database['public']['Functions']['reminder_agenda']['Returns'][number];
export type Reminder = Database['public']['Tables']['reminders']['Row'];
type Task = Database['public']['Tables']['tasks']['Row'];
type Profile = Database['public']['Tables']['profiles']['Row'];

export type ReminderSettings = Pick<
  Profile,
  'reminder_time' | 'remind_day_before' | 'remind_day_of' | 'quiet_start' | 'quiet_end' | 'reminder_preview' | 'timezone'
>;

export const DEFAULT_REMINDER_TIME = '09:00:00';

// ── agenda / actions ────────────────────────────────────────────────────

export async function getAgenda(userId: string): Promise<AgendaItem[]> {
  const { data, error } = await supabase.rpc('reminder_agenda', { p_user: userId });
  if (error) throw error;
  return data ?? [];
}

export type ActResult = { nextFireAt: string | null; effectiveUntil: string | null; affected: number };

export async function act(
  userId: string,
  targetType: ReminderTargetType,
  targetId: string,
  action: ReminderAction,
  until?: Date
): Promise<ActResult> {
  const { data, error } = await supabase.rpc('reminder_act', {
    p_user: userId,
    p_target_type: targetType,
    p_target_id: targetId,
    p_action: action,
    p_until: until ? until.toISOString() : null,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    nextFireAt: row?.next_fire_at ?? null,
    effectiveUntil: row?.effective_until ?? null,
    affected: row?.affected ?? 0,
  };
}

/** Does this target still exist (and is it this user's)? Used for a stale notification tap. */
export async function getTargetState(
  targetType: ReminderTargetType,
  targetId: string
): Promise<{ exists: false } | { exists: true; title: string; done: boolean; sourceSessionId: string | null }> {
  if (targetType === 'task') {
    const { data, error } = await supabase
      .from('tasks')
      .select('title, status, source_session_id')
      .eq('id', targetId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { exists: false };
    return { exists: true, title: data.title, done: data.status !== 'open', sourceSessionId: data.source_session_id };
  }
  if (targetType === 'session') {
    const { data, error } = await supabase.from('sessions').select('title').eq('id', targetId).maybeSingle();
    if (error) throw error;
    if (!data) return { exists: false };
    return { exists: true, title: data.title ?? 'Recording', done: false, sourceSessionId: targetId };
  }
  const { data, error } = await supabase
    .from('memories')
    .select('content, source_session_id')
    .eq('id', targetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { exists: false };
  return { exists: true, title: data.content, done: false, sourceSessionId: data.source_session_id };
}

// ── a task's reminder rules ─────────────────────────────────────────────

export async function listTaskReminders(taskId: string): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export type TaskReminderMode = 'automatic' | 'daily' | { once: Date } | 'off';

const TIME_KINDS = ['due', 'daily', 'once'] as const;

/** Live now, or stopped only for a reason the DB brings back on its own (a date re-added, the task reopened). */
function couldFire(r: Reminder): boolean {
  return r.status === 'active' || r.status_reason === 'no_due_date' || r.status_reason === 'target_done';
}

/**
 * One reminder setting per task, from the Tasks editor:
 *  - automatic: the default day-before/day-of reminder (needs a due date)
 *  - daily: every day at the default time until the task is done
 *  - once: a single moment
 *  - off: no time-based reminder (a "by place" one, if any, stays)
 * Replaced rules are stopped, not deleted, so history stays readable.
 */
export async function setTaskReminderMode(userId: string, task: Task, mode: TaskReminderMode): Promise<void> {
  if (mode === 'automatic' && !task.due_date) throw new Error('Add a due date first.');
  if (typeof mode === 'object' && mode.once.getTime() <= Date.now()) throw new Error('Pick a time in the future.');

  const existing = await listTaskReminders(task.id);
  const defaultRow = existing.find((r) => r.origin === 'default');
  const timezone = deviceTimeZone() ?? 'UTC';
  const title = task.title.slice(0, 300);

  // 1. Stop the user's own time-based rules (the new one replaces them).
  const userTimeIds = existing
    .filter((r) => r.origin === 'user' && couldFire(r) && (TIME_KINDS as readonly string[]).includes(r.kind))
    .map((r) => r.id);
  if (userTimeIds.length > 0) {
    const { error } = await supabase
      .from('reminders')
      .update({ status: 'stopped', status_reason: 'user_stopped' })
      .in('id', userTimeIds);
    if (error) throw error;
  }

  if (mode === 'automatic') {
    if (defaultRow) {
      if (defaultRow.status !== 'active') {
        const { error } = await supabase
          .from('reminders')
          .update({ status: 'active', status_reason: null, snoozed_until: null, suppressed_until: null })
          .eq('id', defaultRow.id);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase
        .from('reminders')
        .insert({ user_id: userId, task_id: task.id, kind: 'due', origin: 'default', title, timezone });
      if (error) throw error;
    }
    return;
  }

  if (mode === 'off') {
    if (defaultRow) {
      if (couldFire(defaultRow)) {
        const { error } = await supabase
          .from('reminders')
          .update({ status: 'stopped', status_reason: 'user_stopped' })
          .eq('id', defaultRow.id);
        if (error) throw error;
      }
    } else {
      // Keeps the automatic one from appearing later when a date is added.
      const { error } = await supabase.from('reminders').insert({
        user_id: userId,
        task_id: task.id,
        kind: 'due',
        origin: 'default',
        title,
        timezone,
        status: 'stopped',
        status_reason: 'user_stopped',
      });
      if (error) throw error;
    }
    return;
  }

  // daily / once: inserting a user rule stops the automatic one (DB trigger).
  const insert: Database['public']['Tables']['reminders']['Insert'] =
    mode === 'daily'
      ? { user_id: userId, task_id: task.id, kind: 'daily', origin: 'user', title, timezone }
      : { user_id: userId, task_id: task.id, kind: 'once', origin: 'user', title, timezone, fire_at: mode.once.toISOString() };
  const { error } = await supabase.from('reminders').insert(insert);
  if (error) throw error;
}

/** Which editor option a task's live rules correspond to. */
export function currentTaskReminderMode(reminders: Reminder[]): 'automatic' | 'daily' | 'once' | 'off' | 'custom' {
  const active = reminders.filter((r) => r.status === 'active' && r.kind !== 'context');
  if (active.length === 0) return 'off';
  if (active.length > 1) return 'custom';
  const r = active[0];
  if (r.kind === 'daily') return 'daily';
  if (r.kind === 'once') return 'once';
  if (r.kind === 'due' && r.origin === 'default') return 'automatic';
  return 'custom';
}

// ── wording ─────────────────────────────────────────────────────────────

/** '09:00:00' -> '9:00 AM' (device locale). */
export function formatClock(hms: string | null | undefined): string {
  const [h, m] = (hms ?? DEFAULT_REMINDER_TIME).split(':').map(Number);
  const d = new Date(2000, 0, 1, h || 0, m || 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** An instant as '3:00 PM' today, 'Tomorrow 9:00 AM', or 'Oct 5, 3:00 PM'. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayDiff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000
  );
  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** 'YYYY-MM-DD' -> 'Oct 5' (a local calendar date, never shifted by UTC). */
export function formatDate(ymd: string | null | undefined): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const RECUR_LABEL: Record<TaskRecurFreq, string> = { day: 'daily', week: 'weekly', month: 'monthly' };

/** 'monthly', or 'every 2 weeks' for an interval set by voice. */
export function recurLabel(freq: TaskRecurFreq, interval: number | null | undefined): string {
  if (!interval || interval <= 1) return RECUR_LABEL[freq];
  const unit = freq === 'day' ? 'days' : freq === 'week' ? 'weeks' : 'months';
  return `every ${interval} ${unit}`;
}

/** The short line under an agenda item's title ("Due today", "3:00 PM", "Check for a reply"). */
export function agendaReasonLabel(item: AgendaItem): string {
  const labels: Record<ReminderReason, () => string> = {
    overdue: () => (item.due_date ? `Overdue · was due ${formatDate(item.due_date)}` : 'Overdue'),
    due_today: () => 'Due today',
    daily: () => 'Every day',
    scheduled_today: () => (item.next_fire_at ? formatWhen(item.next_fire_at) : 'Today'),
    pending: () => 'Still open',
    snoozed: () => (item.snoozed_until ? `Back ${formatWhen(item.snoozed_until)}` : 'Snoozed'),
    not_today: () => (item.suppressed_until ? `Back ${formatWhen(item.suppressed_until)}` : 'Not today'),
    upcoming: () =>
      item.next_fire_at
        ? `Next ${formatWhen(item.next_fire_at)}`
        : item.due_date
          ? `Due ${formatDate(item.due_date)}`
          : 'Upcoming',
    context: () => (item.context_tag ? `At ${item.context_tag}` : 'By place'),
  };
  const base = labels[item.reason]?.() ?? '';
  if (item.purpose === 'waiting' && (item.reason === 'scheduled_today' || item.reason === 'daily' || item.reason === 'pending')) {
    return 'Check for a reply';
  }
  return base;
}

/**
 * A task's live rules in one line: "Day before & day of, 9:00 AM",
 * "Every day at 9:00 AM until done", "Oct 5, 3:00 PM", "Off".
 */
export function describeTaskReminders(
  task: Pick<Task, 'due_date' | 'status'>,
  reminders: Reminder[],
  settings: Pick<ReminderSettings, 'reminder_time' | 'remind_day_before' | 'remind_day_of'> | null
): string {
  const defaultTime = settings?.reminder_time ?? DEFAULT_REMINDER_TIME;
  const active = reminders.filter((r) => r.status === 'active');
  if (task.status !== 'open') return 'Off (task done)';
  if (active.length === 0) return 'Off';
  const parts = active.map((r) => {
    const time = formatClock(r.local_time ?? defaultTime);
    if (r.kind === 'daily') return `Every day at ${time} until done`;
    if (r.kind === 'once') return formatWhen(r.fire_at);
    if (r.kind === 'context') return `At ${r.context_tag ?? 'a place'}`;
    // due
    if (!task.due_date) return 'Off (no due date)';
    const offsets =
      r.day_offsets ??
      [settings?.remind_day_before === false ? null : -1, settings?.remind_day_of === false ? null : 0].filter(
        (x): x is number => x !== null
      );
    if (offsets.length === 0) return 'Off (day before and day of are off in Settings)';
    const words = offsets
      .slice()
      .sort((a, b) => a - b)
      .map((o) => (o === 0 ? 'day of' : o === -1 ? 'day before' : o < 0 ? `${-o} days before` : `${o} days after`));
    const text = words.join(' & ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}, ${time}`;
  });
  const snoozed = active.map((r) => r.snoozed_until).find((s) => s && new Date(s).getTime() > Date.now());
  return parts.join(' + ') + (snoozed ? ` · snoozed until ${formatWhen(snoozed)}` : '');
}

// ── settings ────────────────────────────────────────────────────────────

export async function getReminderSettings(userId: string): Promise<ReminderSettings | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('reminder_time, remind_day_before, remind_day_of, quiet_start, quiet_end, reminder_preview, timezone')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateReminderSettings(
  userId: string,
  patch: Partial<Omit<ReminderSettings, 'timezone'>>
): Promise<ReminderSettings> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select('reminder_time, remind_day_before, remind_day_of, quiet_start, quiet_end, reminder_preview, timezone')
    .single();
  if (error) throw error;
  return data;
}

/** 'HH:MM[:SS]' -> minutes after midnight. */
export function clockMinutes(hms: string): number {
  const [h, m] = hms.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
}

/** Same rule as the server's reminder_in_quiet(): start inclusive, end exclusive, may wrap midnight. */
export function isInQuietHours(hms: string, quietStart: string | null, quietEnd: string | null): boolean {
  if (!quietStart || !quietEnd) return false;
  const t = clockMinutes(hms);
  const s = clockMinutes(quietStart);
  const e = clockMinutes(quietEnd);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** Saves the device's IANA zone to the profile when it differs (the scheduler works in it). */
export async function syncDeviceTimeZone(userId: string): Promise<void> {
  const tz = deviceTimeZone();
  if (!tz) return;
  const { data, error } = await supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle();
  if (error || !data || data.timezone === tz) return;
  await supabase.from('profiles').update({ timezone: tz }).eq('id', userId);
}

// ── server functions ────────────────────────────────────────────────────

/**
 * Why a phone got no test push (see testNoDeviceReason in
 * supabase/functions/_shared/reminderPush.ts):
 *   not_registered -- the server has no registration for it under this account
 *   permission_off -- registered with notifications not allowed
 *   no_token       -- allowed, but it couldn't get a push address (Android: no Firebase in the build)
 *   disabled       -- its push address was rejected by Google/Apple and switched off
 */
export type TestPushReason = 'not_registered' | 'no_token' | 'permission_off' | 'disabled';

export type TestPushDelivery = {
  installationId: string;
  /** The delivery's status: accepted / delivered / failed / error (retried) / uncertain. */
  status: string;
  /** Expo's error code (or message) when it went wrong. */
  error?: string;
  /** Only when Expo accepted it: what FCM/APNs said within a few seconds ('pending' = nothing yet). */
  receipt?: 'delivered' | 'failed' | 'pending';
  receiptError?: string;
};

export type TestPushResult = {
  /** Devices it was sent to. */
  installations: number;
  sent: number;
  results: TestPushDelivery[];
  /** Why this phone (or, sent without an installationId, the account) got nothing. Absent when it was sent. */
  reason?: TestPushReason;
  /** With 'disabled': the push service's error that switched it off. */
  lastError?: string;
};

/**
 * Sends a test push to every enabled device of this account
 * (reminders-dispatch, test mode). `installationId` = this phone, so the
 * answer can say why THIS phone got nothing. Takes a few seconds: the server
 * waits for Google/Apple's answer. A failure carries `status` (HTTP) --
 * 404 means the function isn't deployed.
 */
export async function sendTestPush(installationId?: string | null): Promise<TestPushResult> {
  const { data, error } = await supabase.functions.invoke('reminders-dispatch', {
    body: installationId ? { mode: 'test', installationId } : { mode: 'test' },
  });
  if (error) {
    const status = error instanceof FunctionsHttpError ? error.context.status : undefined;
    const e: Error & { status?: number } = await describeFunctionError(error, 'Could not send a test notification.');
    if (status) e.status = status;
    throw e;
  }
  const result = (data ?? {}) as Partial<TestPushResult>;
  return {
    ...result,
    installations: typeof result.installations === 'number' ? result.installations : 0,
    sent: typeof result.sent === 'number' ? result.sent : 0,
    results: Array.isArray(result.results) ? result.results : [],
  };
}

export type BriefingItem = {
  index: number;
  targetType: ReminderTargetType;
  targetId: string;
  title: string;
  reason: string;
  dueDate: string | null;
  line: string;
};

export type Briefing = {
  count: number;
  items: BriefingItem[];
  script: string;
  audioBase64: string | null;
  audioMime: string;
  cached: boolean;
  briefingId: string | null;
};

/** Today's spoken briefing -- the same agenda as Home and the list, in the user's AI voice. */
export async function getBriefing(): Promise<Briefing> {
  const { data, error } = await supabase.functions.invoke('reminder-briefing', {
    body: { timezone: deviceTimeZone(), lang: deviceLanguage() },
  });
  if (error) throw await describeFunctionError(error, 'Could not prepare the briefing.');
  return data as Briefing;
}
