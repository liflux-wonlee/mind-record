// Pure logic of the reminder dispatcher (supabase/functions/reminders-dispatch):
// the push text, chunking, how an Expo ticket/receipt/HTTP outcome maps to
// a reminder_deliveries status, and the retry schedule. No Deno or npm
// imports -- unit tested with Node (supabase/tests/reminders_pure.test.ts).
//
// Delivery statuses (see 20260929000001_reminders.sql):
//   accepted  -- Expo took the message (a ticket id). NOT "shown on the
//                device", let alone "read by the user".
//   delivered -- the receipt says Expo handed it to FCM/APNs. Still NOT
//                "seen": the OS may drop or delay it, the user may never look.
//   failed    -- will not be delivered (bad token, gave up retrying).
//   error     -- rejected for a reason that may pass; retried a few times.
//   uncertain -- we got no answer at all (timeout / connection cut). Expo may
//                or may not have taken it, so it is NOT retried: a retry could
//                push the same reminder twice.

export const EXPO_SEND_CHUNK = 100;
export const EXPO_RECEIPT_CHUNK = 300;
export const MAX_ATTEMPTS = 3;
/** A slot not sent within this long after its time is given up on. */
export const GIVE_UP_AFTER_MS = 30 * 60_000;
/** How long Expo/FCM/APNs keep trying to reach an offline device. */
export const PUSH_TTL_SECONDS = 6 * 3600;
export const ANDROID_CHANNEL_ID = 'reminders';

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Constant-time string comparison (for the cron secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function targetKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`;
}

/** An instant truncated to the whole second, as ISO. */
export function truncateToSecond(at: Date): string {
  return new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export type PushTextInput = {
  targetType: 'task' | 'session' | 'memory';
  purpose: string;
  title: string;
  note: string | null;
  /** The task's due date (local YYYY-MM-DD), if any. */
  dueDate: string | null;
  /** The slot's local date in the user's zone. */
  slotDate: string;
  /** profiles.reminder_preview: false = nothing about the item on the lock screen. */
  preview: boolean;
};

const NEUTRAL = { title: 'Reminder', body: 'You have a reminder. Open the app to see it.' };

/**
 * The notification's title and body. Short English (the app's UI language).
 * With previews off, a neutral text that says nothing about the item.
 */
export function buildPushText(input: PushTextInput): { title: string; body: string } {
  if (!input.preview) return { ...NEUTRAL };
  let title = 'Reminder';
  if (input.purpose === 'waiting') {
    title = 'Check for a reply';
  } else if (input.targetType === 'task' && input.dueDate) {
    if (input.dueDate < input.slotDate) title = 'Overdue';
    else if (input.dueDate === input.slotDate) title = 'Due today';
    else if (input.dueDate === addDaysYmd(input.slotDate, 1)) title = 'Due tomorrow';
  }
  const main = clip(input.title || 'Reminder', 120);
  const note = input.note ? clip(input.note, 90) : '';
  return { title, body: note ? `${main} — ${note}` : main };
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  channelId: string;
  ttl: number;
};

export function buildExpoMessage(to: string, text: { title: string; body: string }, data: Record<string, unknown>): ExpoMessage {
  return {
    to,
    title: text.title,
    body: text.body,
    data,
    sound: 'default',
    priority: 'high',
    channelId: ANDROID_CHANNEL_ID,
    ttl: PUSH_TTL_SECONDS,
  };
}

export type TicketOutcome =
  | { status: 'accepted'; ticketId: string }
  | { status: 'failed'; error: string; disableInstallation: boolean }
  | { status: 'error'; error: string };

/** One push ticket (https://docs.expo.dev/push-notifications/sending-notifications/#push-tickets). */
export function classifyTicket(ticket: unknown): TicketOutcome {
  const t = (ticket ?? {}) as { status?: unknown; id?: unknown; message?: unknown; details?: { error?: unknown } };
  if (t.status === 'ok' && typeof t.id === 'string' && t.id) return { status: 'accepted', ticketId: t.id };
  const code = typeof t.details?.error === 'string' ? t.details.error : '';
  const message = typeof t.message === 'string' ? t.message : '';
  const error = clip(code || message || 'unknown ticket error', 300);
  if (code === 'DeviceNotRegistered') return { status: 'failed', error, disableInstallation: true };
  // Retrying the same message can't help these.
  if (code === 'MessageTooBig' || code === 'InvalidCredentials' || code === 'MismatchSenderId') {
    return { status: 'failed', error, disableInstallation: false };
  }
  return { status: 'error', error };
}

export type ReceiptOutcome =
  | { status: 'delivered' }
  | { status: 'failed'; error: string; disableInstallation: boolean }
  | { status: 'pending' };

/**
 * One push receipt. 'delivered' means Expo handed the message to FCM/APNs --
 * NOT that the device showed it or that the user saw it. A missing receipt
 * ('pending') isn't ready yet (or has expired on Expo's side).
 */
export function classifyReceipt(receipt: unknown): ReceiptOutcome {
  if (!receipt || typeof receipt !== 'object') return { status: 'pending' };
  const r = receipt as { status?: unknown; message?: unknown; details?: { error?: unknown } };
  if (r.status === 'ok') return { status: 'delivered' };
  if (r.status !== 'error') return { status: 'pending' };
  const code = typeof r.details?.error === 'string' ? r.details.error : '';
  const message = typeof r.message === 'string' ? r.message : '';
  return { status: 'failed', error: clip(code || message || 'unknown receipt error', 300), disableInstallation: code === 'DeviceNotRegistered' };
}

/**
 * What to do after a send attempt that may be retried ('error'): retry after
 * a backoff, or give up ('failed') after MAX_ATTEMPTS or once the slot is
 * more than GIVE_UP_AFTER_MS old. `attempts` counts the attempt just made.
 */
export function retryDecision(
  attempts: number,
  slotAt: Date,
  now: Date
): { status: 'error'; nextAttemptAt: string } | { status: 'failed' } {
  const deadline = slotAt.getTime() + GIVE_UP_AFTER_MS;
  if (attempts >= MAX_ATTEMPTS || now.getTime() >= deadline) return { status: 'failed' };
  // 30s, 2m, 8m ...
  const backoff = 30_000 * Math.pow(4, Math.max(0, attempts - 1));
  const next = now.getTime() + backoff;
  if (next >= deadline) return { status: 'failed' };
  return { status: 'error', nextAttemptAt: new Date(next).toISOString() };
}

export type SendResult =
  /** Expo answered 2xx with one ticket per message. */
  | { kind: 'tickets'; tickets: unknown[] }
  /** Expo answered, but with an error status (the batch was rejected). */
  | { kind: 'http_error'; status: number; error: string }
  /** No usable answer (timeout, connection cut, unreadable 2xx body): outcome unknown. */
  | { kind: 'no_response'; error: string };

/** Per-message outcome of one send call, in message order. */
export type MessageOutcome = TicketOutcome | { status: 'uncertain'; error: string } | { status: 'retry'; error: string };

/**
 * Maps one Expo send call's result to an outcome per message. A rejected
 * call ('http_error') may be retried; no answer, or an answer that doesn't
 * account for every message, is 'uncertain' and never retried.
 */
export function outcomesForSend(result: SendResult, count: number): MessageOutcome[] {
  if (result.kind === 'http_error') {
    return Array.from({ length: count }, () => ({ status: 'retry' as const, error: clip(`HTTP ${result.status}: ${result.error}`, 300) }));
  }
  if (result.kind === 'no_response') {
    return Array.from({ length: count }, () => ({ status: 'uncertain' as const, error: clip(result.error || 'no response', 300) }));
  }
  if (!Array.isArray(result.tickets) || result.tickets.length !== count) {
    return Array.from({ length: count }, () => ({ status: 'uncertain' as const, error: 'ticket count mismatch' }));
  }
  return result.tickets.map(classifyTicket);
}

/** Parses Expo's send response body ({ data: [...] }) into a SendResult for a 2xx answer. */
export function parseSendBody(status: number, body: unknown): SendResult {
  if (status < 200 || status >= 300) {
    const errors = (body as { errors?: { message?: unknown; code?: unknown }[] } | null)?.errors;
    const first = Array.isArray(errors) && errors[0] ? String(errors[0].code ?? errors[0].message ?? '') : '';
    return { kind: 'http_error', status, error: first || 'rejected' };
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (Array.isArray(data)) return { kind: 'tickets', tickets: data };
  // A single-message request can come back as one object.
  if (data && typeof data === 'object') return { kind: 'tickets', tickets: [data] };
  return { kind: 'no_response', error: 'unreadable response body' };
}

// ── test push ("Send test notification" in Settings) ────────────────────

/**
 * Waits before each receipt check of a test push (~6s in all). FCM/APNs
 * usually answer within a second or two -- long enough to catch a missing
 * FCM key (InvalidCredentials) while the user is still looking.
 */
export const TEST_RECEIPT_POLL_MS = [2000, 2000, 2000];

/**
 * Why a phone gets no test push:
 *   not_registered -- no push_installations row: the app never registered it for this account
 *   permission_off -- registered, but the OS notification permission isn't granted
 *   no_token       -- permission granted but no push token: the phone couldn't get one
 *                     (on Android almost always a build without Firebase / google-services.json)
 *   disabled       -- had a token, switched off after the push service rejected it
 */
export type TestNoDeviceReason = 'not_registered' | 'no_token' | 'permission_off' | 'disabled';

export type InstallationState = {
  installation_id: string;
  expo_push_token: string | null;
  permission: string;
  enabled: boolean;
  last_error: string | null;
  last_seen_at: string;
};

export function isUsableInstallation(row: InstallationState): boolean {
  return row.enabled && !!row.expo_push_token;
}

/**
 * Why the asking phone -- or, when the app doesn't say which it is, the
 * account's most recently seen one -- gets no test push. Null when that
 * install is usable. `lastError` only for 'disabled'.
 */
export function testNoDeviceReason(
  rows: InstallationState[],
  installationId?: string | null
): { reason: TestNoDeviceReason; lastError?: string } | null {
  const row = installationId
    ? rows.find((r) => r.installation_id === installationId)
    : rows.slice().sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))[0];
  if (!row) return { reason: 'not_registered' };
  if (isUsableInstallation(row)) return null;
  if (row.permission !== 'granted') return { reason: 'permission_off' };
  if (!row.expo_push_token) return { reason: 'no_token' };
  return row.last_error ? { reason: 'disabled', lastError: clip(row.last_error, 300) } : { reason: 'disabled' };
}

/** One device's line in the test-mode answer. `error`/`receiptError` carry Expo's code (or message). */
export type TestPushItem = {
  installationId: string;
  /** The delivery row's final status (accepted / delivered / failed / error / uncertain). */
  status: string;
  error?: string;
  /** Only for a push Expo accepted: what FCM/APNs said within ~6s ('pending' = no answer yet). */
  receipt?: 'delivered' | 'failed' | 'pending';
  receiptError?: string;
};

/**
 * A device's result from its send outcome and, when Expo accepted it, the
 * receipt (undefined = none arrived in time). A failed receipt also sets
 * `error`, so an app that only reads `error` still sees why.
 */
export function testResultItem(installationId: string, sent: { status: string; error?: string }, receipt?: ReceiptOutcome): TestPushItem {
  const item: TestPushItem = sent.error ? { installationId, status: sent.status, error: sent.error } : { installationId, status: sent.status };
  if (sent.status !== 'accepted') return item;
  if (!receipt || receipt.status === 'pending') return { ...item, receipt: 'pending' };
  if (receipt.status === 'delivered') return { ...item, status: 'delivered', receipt: 'delivered' };
  return { installationId, status: 'failed', error: receipt.error, receipt: 'failed', receiptError: receipt.error };
}
