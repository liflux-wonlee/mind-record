// Pure date/time rules for reminders -- shared by converse's reminder tools,
// process-session and the briefing (through _shared/reminders.ts), and unit
// tested with Node (supabase/tests/reminders_pure.test.ts). No Deno or npm
// imports here on purpose.
//
// Dates are local calendar dates ("YYYY-MM-DD") in the user's IANA zone;
// times are local wall-clock "HH:MM". Turning them into an instant is the
// only place a zone offset is involved (zonedToInstant), so "3 days before"
// is always 3 calendar days, never 72 hours.

export const MAX_DAYS_AHEAD = 730;
export const MAX_IN_MINUTES = 60 * 24 * 60; // 60 days
export const MAX_LEAD_DAYS = 365;

export function isValidYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "9:5", "09:05", "9:05:00" -> "09:05"; anything else -> null. */
export function normalizeHm(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Calendar days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function weekdayOf(ymd: string, lang: 'en' | 'ko' = 'en'): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const i = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return lang === 'ko' ? WEEKDAYS_KO[i] : WEEKDAYS[i];
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

function partsIn(at: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second };
}

/** The zone's offset from UTC at an instant, in ms (Seoul = +9h). */
function offsetAt(at: Date, tz: string): number {
  const p = partsIn(at, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * The instant a local date + wall-clock time happens in `tz` -- the same
 * answer as the database's `(date + time) AT TIME ZONE tz`
 * (reminder_local_ts): a time skipped by a DST jump is read with the offset
 * from before the jump (02:30 on spring-forward day -> 03:30 new time); a
 * repeated time (fall back) is read as standard time (the later instant).
 */
export function zonedToInstant(ymd: string, hm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const before = offsetAt(new Date(wall - 86_400_000), tz);
  const after = offsetAt(new Date(wall + 86_400_000), tz);
  const reads = (t: number) => {
    const p = partsIn(new Date(t), tz);
    return p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi;
  };
  const valid = [...new Set([wall - before, wall - after])].filter(reads);
  if (valid.length > 0) return new Date(Math.max(...valid));
  return new Date(wall - before);
}

/** Local "YYYY-MM-DD" of an instant in tz. */
export function localDateOf(at: Date, tz: string): string {
  const p = partsIn(at, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Local "HH:MM" of an instant in tz. */
export function localTimeOf(at: Date, tz: string): string {
  const p = partsIn(at, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/** "YYYY-MM-DD HH:MM (Wed)" in tz -- for tool results the model reads. */
export function localStamp(at: Date | string | null | undefined, tz: string): string | null {
  if (!at) return null;
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return null;
  const ymd = localDateOf(d, tz);
  return `${ymd} ${localTimeOf(d, tz)} (${weekdayOf(ymd)})`;
}

/**
 * Checks a reminder date against the user's today: not in the past (unless
 * allowPast), not absurdly far ahead. Returns an error message or null.
 */
export function validateReminderDate(
  ymd: unknown,
  today: string,
  opts: { allowPast?: boolean; maxDaysAhead?: number; field?: string } = {}
): string | null {
  const field = opts.field ?? 'date';
  if (!isValidYmd(ymd)) return `${field} must be a real YYYY-MM-DD date. Today is ${today}.`;
  const diff = daysBetween(today, ymd);
  if (!opts.allowPast && diff < 0) return `${field} ${ymd} is in the past (today is ${today}).`;
  if (diff > (opts.maxDaysAhead ?? MAX_DAYS_AHEAD)) return `${field} ${ymd} is too far ahead.`;
  return null;
}

/** "in N minutes" -> an absolute instant, or an error. */
export function instantInMinutes(now: Date, minutes: unknown): { at: Date } | { error: string } {
  const n = typeof minutes === 'number' ? minutes : typeof minutes === 'string' ? Number(minutes) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return { error: 'minutes must be a whole number of at least 1.' };
  if (n > MAX_IN_MINUTES) return { error: `minutes must be at most ${MAX_IN_MINUTES} (60 days); use a date instead.` };
  return { at: new Date(now.getTime() + n * 60_000) };
}

/**
 * Preparation lead time: "Mom's birthday is Wed 10/14, order at least 3 days
 * before" -> order by Sun 10/11. Calendar days, never business days. A due
 * date that is already past is kept as it is (late = true) -- never moved.
 */
export function leadDueDate(
  eventDate: unknown,
  leadDays: unknown,
  today: string
): { dueDate: string; late: boolean; eventDate: string; leadDays: number } | { error: string } {
  if (!isValidYmd(eventDate)) return { error: `event_date must be a real YYYY-MM-DD date. Today is ${today}.` };
  const n = typeof leadDays === 'number' ? leadDays : typeof leadDays === 'string' ? Number(leadDays) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_LEAD_DAYS) return { error: `lead_days must be a whole number from 0 to ${MAX_LEAD_DAYS}.` };
  if (daysBetween(today, eventDate) > MAX_DAYS_AHEAD) return { error: `event_date ${eventDate} is too far ahead.` };
  const dueDate = addDays(eventDate, -n);
  return { dueDate, late: dueDate < today, eventDate, leadDays: n };
}

/** The stored explanation of a lead-time due date (kept in the task description and reminder note). */
export function leadNote(lead: { eventDate: string; leadDays: number; dueDate: string }, what?: string | null): string {
  const e = lead.eventDate;
  const d = lead.dueDate;
  const [, em, ed] = e.split('-').map(Number);
  const [, dm, dd] = d.split('-').map(Number);
  const head = what?.trim() ? `${what.trim()}: ` : '';
  return `${head}${weekdayOf(e)} ${em}/${ed} -> by ${weekdayOf(d)} ${dm}/${dd} (${lead.leadDays} day${lead.leadDays === 1 ? '' : 's'} before)`;
}

/** Whether a local "HH:MM" is inside quiet hours start-end (which may wrap midnight). */
export function inQuietHours(hm: string, start: string | null | undefined, end: string | null | undefined): boolean {
  const s = normalizeHm(start ?? '');
  const e = normalizeHm(end ?? '');
  if (!s || !e || s === e) return false;
  if (s < e) return hm >= s && hm < e;
  return hm >= s || hm < e;
}

/** "Home", " home " -> "home"; empty / too long -> null. */
export function normalizeContextTag(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const tag = v.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!tag || tag.length > 40) return null;
  return tag;
}

/** Case/spacing/punctuation-insensitive form of a task title, for spotting the same task. */
export function normalizeTaskTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** An explicit reminder request extracted from a recording by process-session's analysis. */
export type ReminderRequest = {
  type: 'default' | 'at' | 'in' | 'daily_until_done' | 'context';
  date: string | null;
  time: string | null;
  minutes: number | null;
  start_date: string | null;
  ends_on: string | null;
  context_tag: string | null;
  event_date: string | null;
  lead_days: number | null;
  purpose: 'remind' | 'waiting';
  note: string | null;
  /** The speaker's own words asking for it. */
  quote: string | null;
};

/**
 * Model output is untrusted: keeps a reminder request only if it is complete
 * and well-formed for its type (a record-level one can't be 'default', which
 * needs a task's due date). Returns null for anything else.
 */
export function sanitizeReminderRequest(raw: unknown, opts: { recordLevel: boolean }): ReminderRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const type = r.type;
  if (type !== 'default' && type !== 'at' && type !== 'in' && type !== 'daily_until_done' && type !== 'context') return null;
  if (opts.recordLevel && type === 'default') return null;
  const date = isValidYmd(r.date) ? (r.date as string) : null;
  const time = normalizeHm(r.time);
  const minutesRaw = typeof r.minutes === 'number' ? r.minutes : Number(r.minutes);
  const minutes = Number.isInteger(minutesRaw) && minutesRaw >= 1 && minutesRaw <= MAX_IN_MINUTES ? minutesRaw : null;
  const context_tag = normalizeContextTag(r.context_tag);
  const eventDate = isValidYmd(r.event_date) ? (r.event_date as string) : null;
  const leadRaw = typeof r.lead_days === 'number' ? r.lead_days : Number(r.lead_days);
  const lead_days = eventDate && Number.isInteger(leadRaw) && leadRaw >= 0 && leadRaw <= MAX_LEAD_DAYS ? leadRaw : null;
  if (type === 'at' && !date) return null;
  if (type === 'in' && minutes === null) return null;
  if (type === 'context' && !context_tag) return null;
  return {
    type,
    date,
    time,
    minutes,
    start_date: isValidYmd(r.start_date) ? (r.start_date as string) : null,
    ends_on: isValidYmd(r.ends_on) ? (r.ends_on as string) : null,
    context_tag,
    event_date: opts.recordLevel ? null : eventDate,
    lead_days: opts.recordLevel ? null : lead_days,
    purpose: r.purpose === 'waiting' ? 'waiting' : 'remind',
    note: s(r.note, 600),
    quote: s(r.quote, 1000),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * A short spoken form of an instant relative to today, for confirmations:
 * ko "내일 오전 9시", "10월 2일 오후 3시 30분"; en "tomorrow at 9:00 AM", "Oct 2 at 3:30 PM".
 */
export function spokenWhen(at: Date, tz: string, today: string): { ko: string; en: string } {
  const ymd = localDateOf(at, tz);
  const hm = localTimeOf(at, tz);
  const [h, mi] = hm.split(':').map(Number);
  const [, m, d] = ymd.split('-').map(Number);
  const dayKo = ymd === today ? '오늘' : ymd === addDays(today, 1) ? '내일' : `${m}월 ${d}일`;
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayEn = ymd === today ? 'today' : ymd === addDays(today, 1) ? 'tomorrow' : `${monthsEn[m - 1]} ${d}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ko = `${dayKo} ${h < 12 ? '오전' : '오후'} ${h12}시${mi ? ` ${mi}분` : ''}`;
  const en = `${dayEn} at ${h12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return { ko, en };
}

/** Spoken form of a local date: "오늘"/"내일"/"10월 11일(일)", "today"/"tomorrow"/"Sun, Oct 11". */
export function spokenDate(ymd: string, today: string): { ko: string; en: string } {
  if (ymd === today) return { ko: '오늘', en: 'today' };
  if (ymd === addDays(today, 1)) return { ko: '내일', en: 'tomorrow' };
  const [, m, d] = ymd.split('-').map(Number);
  const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return { ko: `${m}월 ${d}일(${weekdayOf(ymd, 'ko')})`, en: `${weekdayOf(ymd)}, ${monthsEn[m - 1]} ${d}` };
}
