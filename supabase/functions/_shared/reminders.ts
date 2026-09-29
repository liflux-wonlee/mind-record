// Creating and changing reminders on the server -- one implementation for
// converse's voice tools (converse/tools.ts: set_reminder, reminder_action,
// undo) and process-session (explicit reminder requests in a recording), so
// both create exactly the same rows. The schedule itself (next_fire_at) is
// always computed by the database (reminder_next_fire in
// 20260929000001_reminders.sql); this only writes the rule.
//
// Every query uses the service-role client with an explicit user_id filter,
// and a target is only used after loadTarget() found it among the user's own
// rows -- never on an id's say-so.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

import type { ReminderSnapshot } from './actionLog.ts';
import { findSimilarName } from './nameMatch.ts';
import {
  daysBetween,
  inQuietHours,
  instantInMinutes,
  isUuid,
  isValidYmd,
  localDateOf,
  localTimeOf,
  normalizeContextTag,
  normalizeHm,
  normalizeTaskTitle,
  validateReminderDate,
  zonedToInstant,
} from './reminderRules.ts';

export type TargetType = 'task' | 'session' | 'memory';
export const TARGET_TYPES: readonly TargetType[] = ['task', 'session', 'memory'];

export type ReminderWhen =
  | { type: 'default' }
  | { type: 'at'; date: string; time: string | null }
  | { type: 'in'; minutes: number }
  | { type: 'daily_until_done'; time: string | null; start_date: string | null; ends_on: string | null }
  | { type: 'context'; context_tag: string };

export const WHEN_TYPES = ['default', 'at', 'in', 'daily_until_done', 'context'] as const;

export type ReminderProfile = {
  reminder_time: string;
  quiet_start: string | null;
  quiet_end: string | null;
};

export type TargetRow = {
  type: TargetType;
  id: string;
  title: string;
  /** Tasks only. */
  dueDate: string | null;
  status: string | null;
  recurFreq: string | null;
  description: string | null;
  sourceSessionId: string | null;
};

export const SNAPSHOT_COLUMNS =
  'id, status, status_reason, snoozed_until, suppressed_until, local_time, start_date, ends_on, fire_at, note';

const TARGET_COLUMN: Record<TargetType, 'task_id' | 'session_id' | 'memory_id'> = {
  task: 'task_id',
  session: 'session_id',
  memory: 'memory_id',
};

export function targetColumn(type: TargetType): 'task_id' | 'session_id' | 'memory_id' {
  return TARGET_COLUMN[type];
}

/** "09:00:00" -> "09:00"; null stays null. */
function hm(v: string | null | undefined): string | null {
  return v ? normalizeHm(v) : null;
}

export async function loadReminderProfile(db: SupabaseClient, userId: string): Promise<ReminderProfile> {
  const { data, error } = await db
    .from('profiles')
    .select('reminder_time, quiet_start, quiet_end')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return {
    reminder_time: hm(data?.reminder_time) ?? '09:00',
    quiet_start: hm(data?.quiet_start),
    quiet_end: hm(data?.quiet_end),
  };
}

/** Whether the user has at least one app install that can get pushes right now. */
export async function hasEnabledPush(db: SupabaseClient, userId: string): Promise<boolean> {
  const { count, error } = await db
    .from('push_installations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('enabled', true)
    .not('expo_push_token', 'is', null);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** The user's own task / record / idea with this id, or null. */
export async function loadTarget(db: SupabaseClient, userId: string, type: TargetType, id: string): Promise<TargetRow | null> {
  if (!isUuid(id)) return null;
  if (type === 'task') {
    const { data, error } = await db
      .from('tasks')
      .select('id, title, due_date, status, recur_freq, description, source_session_id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      type,
      id: data.id,
      title: data.title,
      dueDate: typeof data.due_date === 'string' ? data.due_date.slice(0, 10) : null,
      status: data.status,
      recurFreq: data.recur_freq ?? null,
      description: data.description ?? null,
      sourceSessionId: data.source_session_id ?? null,
    };
  }
  if (type === 'session') {
    const { data, error } = await db
      .from('sessions')
      .select('id, title, summary')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const title = (data.title?.trim() || data.summary?.trim()?.slice(0, 120) || 'Recording') as string;
    return { type, id: data.id, title, dueDate: null, status: null, recurFreq: null, description: null, sourceSessionId: data.id };
  }
  const { data, error } = await db
    .from('memories')
    .select('id, content, source_session_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    type,
    id: data.id,
    title: String(data.content ?? '').slice(0, 300) || 'Idea',
    dueDate: null,
    status: null,
    recurFreq: null,
    description: null,
    sourceSessionId: data.source_session_id ?? null,
  };
}

/** Validates the shape of a `when` object from a model / extraction. Dates are checked later against today. */
export function parseWhen(raw: unknown): ReminderWhen | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'when is required, e.g. {"type":"default"} or {"type":"at","date":"YYYY-MM-DD"}.' };
  const w = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  switch (w.type) {
    case 'default':
      return { type: 'default' };
    case 'at': {
      const date = str(w.date);
      if (!date) return { error: 'when.date (YYYY-MM-DD) is required for type "at".' };
      const time = str(w.time);
      if (time && !normalizeHm(time)) return { error: 'when.time must be HH:MM (24-hour).' };
      return { type: 'at', date, time: time ? normalizeHm(time) : null };
    }
    case 'in': {
      const minutes = typeof w.minutes === 'number' ? w.minutes : Number(w.minutes);
      if (!Number.isFinite(minutes)) return { error: 'when.minutes is required for type "in".' };
      return { type: 'in', minutes };
    }
    case 'daily_until_done': {
      const time = str(w.time);
      if (time && !normalizeHm(time)) return { error: 'when.time must be HH:MM (24-hour).' };
      return { type: 'daily_until_done', time: time ? normalizeHm(time) : null, start_date: str(w.start_date), ends_on: str(w.ends_on) };
    }
    case 'context': {
      const tag = normalizeContextTag(w.context_tag);
      if (!tag) return { error: 'when.context_tag is required for type "context" (e.g. "home", "office", "car").' };
      return { type: 'context', context_tag: tag };
    }
    default:
      return { error: `when.type must be one of ${WHEN_TYPES.join(', ')}.` };
  }
}

export type ApplyOk = {
  ok: true;
  status: 'created' | 'updated' | 'already_set' | 'reactivated';
  created: string[];
  changed: ReminderSnapshot[];
  /** The rule's own time, for once reminders. */
  fireAt: string | null;
  /** The local time a daily/at/in reminder goes off, "HH:MM". */
  localTime: string | null;
  /** The time the user asked for falls in their quiet hours -- kept as asked; say so. */
  inQuietHours: boolean;
};
export type ApplyError = { ok: false; code: 'needs_due_date' | 'time_passed' | 'invalid'; error: string };
export type ApplyResult = ApplyOk | ApplyError;

type ApplyOptions = {
  userId: string;
  timezone: string;
  now: Date;
  target: TargetRow;
  when: ReminderWhen;
  purpose: 'remind' | 'waiting';
  note: string | null;
  sourceSessionId: string | null;
  sourceQuote: string | null;
  profile: ReminderProfile;
};

/**
 * Puts one reminder rule on a target -- or reuses/adjusts the matching one it
 * already has, so saying the same thing twice never doubles the pushes.
 * Returns what it created (for undo: delete) and what it changed (for undo:
 * restore). Validation failures come back as { ok: false }, never thrown.
 */
export async function applyReminder(db: SupabaseClient, o: ApplyOptions): Promise<ApplyResult> {
  const { userId, timezone, now, target, when, profile } = o;
  const today = localDateOf(now, timezone);
  const col = TARGET_COLUMN[target.type];
  const note = o.note?.trim() ? o.note.trim().slice(0, 1000) : null;
  const quote = o.sourceQuote?.trim() ? o.sourceQuote.trim().slice(0, 1000) : null;

  if (target.type === 'task' && target.status !== 'open') {
    return { ok: false, code: 'invalid', error: 'That task is already completed or cancelled.' };
  }

  const { data: existingRows, error: existingError } = await db
    .from('reminders')
    .select(`${SNAPSHOT_COLUMNS}, kind, origin, purpose, context_tag`)
    .eq('user_id', userId)
    .eq(col, target.id);
  if (existingError) throw existingError;
  const existing = (existingRows ?? []) as (ReminderSnapshot & { kind: string; origin: string; purpose: string; context_tag: string | null })[];
  const snapshot = (r: ReminderSnapshot): ReminderSnapshot => ({
    id: r.id,
    status: r.status,
    status_reason: r.status_reason,
    snoozed_until: r.snoozed_until,
    suppressed_until: r.suppressed_until,
    local_time: r.local_time,
    start_date: r.start_date,
    ends_on: r.ends_on,
    fire_at: r.fire_at,
    note: r.note,
  });

  const base = {
    user_id: userId,
    [col]: target.id,
    origin: 'user',
    purpose: o.purpose,
    title: target.title.slice(0, 300) || 'Reminder',
    note,
    source_session_id: o.sourceSessionId,
    source_quote: quote,
    timezone,
  };
  const insert = async (row: Record<string, unknown>): Promise<string> => {
    const { data, error } = await db.from('reminders').insert({ ...base, ...row }).select('id').single();
    if (error) throw error;
    return data.id as string;
  };
  const ok = (
    status: ApplyOk['status'],
    created: string[],
    changed: ReminderSnapshot[],
    extra: Partial<Pick<ApplyOk, 'fireAt' | 'localTime' | 'inQuietHours'>> = {}
  ): ApplyOk => ({ ok: true, status, created, changed, fireAt: null, localTime: null, inQuietHours: false, ...extra });

  switch (when.type) {
    case 'default': {
      if (target.type !== 'task' || !target.dueDate) {
        return {
          ok: false,
          code: 'needs_due_date',
          error: 'The automatic day-before/day-of reminder needs a task with a due date. Ask for the deadline, or use a specific date/time.',
        };
      }
      const def = existing.find((r) => r.origin === 'default');
      if (!def) {
        // The task trigger normally creates it; make sure it's there.
        const { data, error } = await db
          .from('reminders')
          .insert({ user_id: userId, task_id: target.id, kind: 'due', origin: 'default', title: base.title, timezone })
          .select('id')
          .single();
        if (error && error.code !== '23505') throw error;
        return ok('created', data ? [data.id as string] : [], []);
      }
      if (def.status === 'active') return ok('already_set', [], []);
      const { error } = await db
        .from('reminders')
        .update({ status: 'active', status_reason: null })
        .eq('id', def.id)
        .eq('user_id', userId);
      if (error) throw error;
      return ok('reactivated', [], [snapshot(def)]);
    }

    case 'at': {
      const dateError = validateReminderDate(when.date, today);
      if (dateError) return { ok: false, code: 'invalid', error: dateError };
      const time = when.time ?? profile.reminder_time;
      const fireAt = zonedToInstant(when.date, time, timezone);
      if (fireAt.getTime() <= now.getTime()) {
        return {
          ok: false,
          code: 'time_passed',
          error: `${when.date} ${time} has already passed (it is now ${localTimeOf(now, timezone)} on ${today}). Ask for a later time.`,
        };
      }
      const quiet = inQuietHours(time, profile.quiet_start, profile.quiet_end);
      const same = existing.find(
        (r) => r.kind === 'once' && r.status === 'active' && r.fire_at && new Date(r.fire_at).getTime() === fireAt.getTime()
      );
      if (same) return ok('already_set', [], [], { fireAt: fireAt.toISOString(), localTime: time, inQuietHours: quiet });
      const id = await insert({ kind: 'once', fire_at: fireAt.toISOString() });
      return ok('created', [id], [], { fireAt: fireAt.toISOString(), localTime: time, inQuietHours: quiet });
    }

    case 'in': {
      const r = instantInMinutes(now, when.minutes);
      if ('error' in r) return { ok: false, code: 'invalid', error: r.error };
      // Whole minutes, so two tellings of "in 2 hours" a few seconds apart match.
      const fireAt = new Date(Math.ceil(r.at.getTime() / 60_000) * 60_000);
      const localTime = localTimeOf(fireAt, timezone);
      const quiet = inQuietHours(localTime, profile.quiet_start, profile.quiet_end);
      const same = existing.find(
        (x) => x.kind === 'once' && x.status === 'active' && x.fire_at && Math.abs(new Date(x.fire_at).getTime() - fireAt.getTime()) < 120_000
      );
      if (same) return ok('already_set', [], [], { fireAt: same.fire_at, localTime, inQuietHours: quiet });
      const id = await insert({ kind: 'once', fire_at: fireAt.toISOString() });
      return ok('created', [id], [], { fireAt: fireAt.toISOString(), localTime, inQuietHours: quiet });
    }

    case 'daily_until_done': {
      if (when.start_date) {
        const e = validateReminderDate(when.start_date, today, { field: 'start_date' });
        if (e) return { ok: false, code: 'invalid', error: e };
      }
      if (when.ends_on) {
        const e = validateReminderDate(when.ends_on, today, { field: 'ends_on' });
        if (e) return { ok: false, code: 'invalid', error: e };
        if (when.start_date && daysBetween(when.start_date, when.ends_on) < 0) {
          return { ok: false, code: 'invalid', error: 'ends_on must not be before start_date.' };
        }
      }
      const localTime = when.time ?? profile.reminder_time;
      const quiet = inQuietHours(localTime, profile.quiet_start, profile.quiet_end);
      // "Keep reminding me" is once a day: one daily rule per target, adjusted in place.
      const daily = existing.find((r) => r.kind === 'daily' && r.status === 'active');
      if (daily) {
        const same =
          hm(daily.local_time) === when.time && (daily.start_date ?? null) === when.start_date && (daily.ends_on ?? null) === when.ends_on;
        if (same && (!note || note === daily.note)) return ok('already_set', [], [], { localTime, inQuietHours: quiet });
        const { error } = await db
          .from('reminders')
          .update({
            local_time: when.time,
            start_date: when.start_date,
            ends_on: when.ends_on,
            purpose: o.purpose,
            ...(note ? { note } : {}),
          })
          .eq('id', daily.id)
          .eq('user_id', userId);
        if (error) throw error;
        return ok('updated', [], [snapshot(daily)], { localTime, inQuietHours: quiet });
      }
      const id = await insert({ kind: 'daily', local_time: when.time, start_date: when.start_date, ends_on: when.ends_on });
      return ok('created', [id], [], { localTime, inQuietHours: quiet });
    }

    case 'context': {
      const same = existing.find((r) => r.kind === 'context' && r.status === 'active' && r.context_tag === when.context_tag);
      if (same) return ok('already_set', [], []);
      const id = await insert({ kind: 'context', context_tag: when.context_tag });
      return ok('created', [id], []);
    }
  }
}

/** The earliest upcoming push for a target (null = none scheduled). */
export async function targetNextFire(db: SupabaseClient, userId: string, type: TargetType, id: string): Promise<string | null> {
  const { data, error } = await db
    .from('reminders')
    .select('next_fire_at')
    .eq('user_id', userId)
    .eq(TARGET_COLUMN[type], id)
    .eq('status', 'active')
    .not('next_fire_at', 'is', null)
    .order('next_fire_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.next_fire_at as string | undefined) ?? null;
}

/** Active reminders of a target, as undo snapshots. */
export async function snapshotTarget(db: SupabaseClient, userId: string, type: TargetType, id: string): Promise<ReminderSnapshot[]> {
  const { data, error } = await db
    .from('reminders')
    .select(SNAPSHOT_COLUMNS)
    .eq('user_id', userId)
    .eq(TARGET_COLUMN[type], id);
  if (error) throw error;
  return (data ?? []) as ReminderSnapshot[];
}

/** Undo: delete reminders an action created, put back ones it changed. */
export async function revertReminderChanges(
  db: SupabaseClient,
  userId: string,
  changes: { created: string[]; changed: ReminderSnapshot[] }
): Promise<void> {
  if (changes.created.length > 0) {
    const { error } = await db.from('reminders').delete().in('id', changes.created).eq('user_id', userId);
    if (error) throw error;
  }
  for (const s of changes.changed) {
    const { id, ...fields } = s;
    // A snooze/"not today" already in the past just lapses (the schedule
    // trigger never goes back before now).
    const { error } = await db.from('reminders').update(fields).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  }
}

/**
 * After a user reminder on a task went away (undo), bring back the automatic
 * day-before/day-of one it had replaced -- unless another user-set time still
 * stands in for it.
 */
export async function restoreDefaultIfUnreplaced(db: SupabaseClient, userId: string, taskId: string): Promise<void> {
  const { count, error } = await db
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .eq('origin', 'user')
    .in('kind', ['due', 'daily', 'once'])
    .eq('status', 'active');
  if (error) throw error;
  if ((count ?? 0) > 0) return;
  const { error: updateError } = await db
    .from('reminders')
    .update({ status: 'active', status_reason: null })
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .eq('origin', 'default')
    .eq('status', 'stopped')
    .eq('status_reason', 'replaced');
  if (updateError) throw updateError;
}

export type OpenTaskLite = { id: string; title: string; due_date: string | null; source_session_id: string | null; name: string };

/** The user's open tasks with the same title (ignoring case/spaces/punctuation), and the closest similar one. */
export async function findSameOpenTask(
  db: SupabaseClient,
  userId: string,
  title: string
): Promise<{ exact: OpenTaskLite[]; similar: OpenTaskLite | null }> {
  const { data, error } = await db
    .from('tasks')
    .select('id, title, due_date, source_session_id')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows: OpenTaskLite[] = (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    due_date: typeof t.due_date === 'string' ? t.due_date.slice(0, 10) : null,
    source_session_id: t.source_session_id ?? null,
    name: t.title,
  }));
  const key = normalizeTaskTitle(title);
  const exact = rows.filter((t) => normalizeTaskTitle(t.title) === key);
  const similar = exact.length > 0 ? null : findSimilarName(rows, title, { shortNames: true });
  return { exact, similar };
}

export function isRepeat(v: unknown): v is { freq: 'day' | 'week' | 'month'; interval?: number } {
  if (!v || typeof v !== 'object') return false;
  const r = v as { freq?: unknown; interval?: unknown };
  if (r.freq !== 'day' && r.freq !== 'week' && r.freq !== 'month') return false;
  if (r.interval === undefined || r.interval === null) return true;
  return Number.isInteger(r.interval) && (r.interval as number) >= 1 && (r.interval as number) <= 365;
}

export { isValidYmd };
