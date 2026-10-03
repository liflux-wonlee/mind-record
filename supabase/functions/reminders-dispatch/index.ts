// Sends reminder pushes through the Expo Push API. Two ways in:
//
// 1. CRON (every minute, from pg_cron -- supabase/migrations/20260929000002_reminders_cron.sql):
//    header `x-cron-secret` = REMINDERS_CRON_SECRET. One run:
//      a. claims due reminders in small leased batches (reminders_claim_due);
//      b. re-reads each one's live state -- target still there, task still
//         open, rule still active and still due at exactly the claimed slot
//         -- and skips it otherwise (the user completed/snoozed it meanwhile);
//      c. a `stale` slot (over 6h late: the dispatcher was down) is only
//         marked handled, never pushed -- no burst of old alerts;
//      d. writes one reminder_deliveries row per (installation, target, slot)
//         with ON CONFLICT DO NOTHING and pushes only the rows it actually
//         inserted: two rules of one target at the same moment, or two
//         overlapping runs, reach each device once;
//      e. records each Expo ticket (accepted / failed / error / uncertain --
//         see _shared/reminderPush.ts) and disables installs Expo reports as
//         DeviceNotRegistered;
//      f. reminders_mark_fired for every claimed reminder, pushed or not (the
//         in-app list shows it either way; the next slot is computed then);
//      g. retries 'error' rows a few times with backoff (after re-checking
//         live state), and turns rows stuck in 'pending' into 'uncertain';
//      h. checks push receipts 15+ minutes later ('delivered' = handed to
//         FCM/APNs, which is NOT "seen by the user").
//    Bounded: stops claiming after ~20s.
//
// 2. TEST ("send a test notification" in Settings): `Authorization: Bearer
//    <user JWT>` and body {"mode":"test", "installationId"?: "<the asking
//    phone's id>"} -- one push to the caller's own enabled installs, right
//    now. The answer says what really happened: why the asking phone (or,
//    without an id, the account) got nothing -- `reason`, see
//    testNoDeviceReason -- and, for what Expo accepted, the push receipt
//    checked for ~6s ('delivered' = handed to FCM/APNs; 'failed' with the
//    code, e.g. InvalidCredentials = the FCM V1 key on Expo is missing or
//    invalid). Receipts found here are recorded like the cron's receipt
//    pass does, so that pass never looks at them again.
//
// Deploy WITHOUT gateway JWT verification (the cron request carries only
// the shared secret; test mode verifies the user's JWT itself):
//   supabase functions deploy reminders-dispatch --no-verify-jwt
//   supabase secrets set REMINDERS_CRON_SECRET=<same value as the Vault secret>
//   supabase secrets set EXPO_ACCESS_TOKEN=<token>   # only if "enhanced push security" is on in Expo
//
// Logs carry counts and error codes only -- never push tokens or the
// reminders' titles.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

import {
  buildExpoMessage,
  buildPushText,
  chunk,
  classifyReceipt,
  EXPO_RECEIPT_CHUNK,
  EXPO_SEND_CHUNK,
  GIVE_UP_AFTER_MS,
  isUsableInstallation,
  outcomesForSend,
  parseSendBody,
  retryDecision,
  targetKey,
  TEST_RECEIPT_POLL_MS,
  testNoDeviceReason,
  testResultItem,
  timingSafeEqual,
  truncateToSecond,
  type ExpoMessage,
  type InstallationState,
  type MessageOutcome,
  type ReceiptOutcome,
  type SendResult,
} from '../_shared/reminderPush.ts';
import { localDateOf } from '../_shared/reminderRules.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('REMINDERS_CRON_SECRET');
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN');

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

const CLAIM_BATCH = 100;
const LEASE_SECONDS = 120;
/** Stop claiming new reminders after this long. */
const CLAIM_BUDGET_MS = 20_000;
/** Skip the retry/receipt passes if a run has already taken this long. */
const PASSES_BUDGET_MS = 35_000;
const EXPO_TIMEOUT_MS = 15_000;
const RECEIPT_DELAY_MS = 15 * 60_000;
/** Expo keeps receipts about a day; stop asking after that. */
const RECEIPT_GIVE_UP_MS = 24 * 3600_000;
/** A 'pending' row this old was never recorded as sent (the run died mid-way): uncertain. */
const STUCK_PENDING_MS = 10 * 60_000;
const RETRY_BATCH = 200;
const RECEIPT_BATCH = 900;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Summary = {
  claimed: number;
  skipped: number;
  stale: number;
  noDevices: number;
  duplicates: number;
  sent: number;
  accepted: number;
  failed: number;
  errors: number;
  uncertain: number;
  retried: number;
  retrySkipped: number;
  stuckPending: number;
  receiptsChecked: number;
  delivered: number;
  receiptFailed: number;
  ms: number;
};

function emptySummary(): Summary {
  return {
    claimed: 0,
    skipped: 0,
    stale: 0,
    noDevices: 0,
    duplicates: 0,
    sent: 0,
    accepted: 0,
    failed: 0,
    errors: 0,
    uncertain: 0,
    retried: 0,
    retrySkipped: 0,
    stuckPending: 0,
    receiptsChecked: 0,
    delivered: 0,
    receiptFailed: 0,
    ms: 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

  const cronHeader = req.headers.get('x-cron-secret');
  if (cronHeader !== null) {
    if (!CRON_SECRET) {
      console.error('reminders-dispatch: REMINDERS_CRON_SECRET is not set');
      return json({ error: 'Not configured.' }, 500);
    }
    if (!timingSafeEqual(cronHeader, CRON_SECRET)) return json({ error: 'Forbidden.' }, 403);
    try {
      const summary = await runCron();
      console.log('[reminders-dispatch]', JSON.stringify(summary));
      return json(summary);
    } catch (e) {
      logError('reminders-dispatch cron failed:', e);
      return json({ error: 'Dispatch failed.' }, 500);
    }
  }

  let mode: unknown;
  let installationId: unknown;
  try {
    ({ mode, installationId } = await req.json());
  } catch {
    // handled below
  }
  if (mode !== 'test') return json({ error: 'Unknown request.' }, 400);
  // Optional (older apps don't send it); same bounds as push_installations.installation_id.
  const askingInstall =
    typeof installationId === 'string' && installationId.length >= 8 && installationId.length <= 100 ? installationId : null;

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
    error: authError,
  } = await callerClient.auth.getUser();
  if (authError || !user) return json({ error: 'Not authenticated.' }, 401);

  try {
    return json(await runTest(user.id, askingInstall));
  } catch (e) {
    logError('reminders-dispatch test failed:', e);
    return json({ error: 'Could not send a test notification. Please try again.' }, 500);
  }
});

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// ── Expo calls ─────────────────────────────────────────────────────────

function expoHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
    ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
  };
}

async function expoSend(messages: ExpoMessage[]): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(EXPO_SEND_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
  } catch (e) {
    // No answer: Expo may or may not have taken them.
    return { kind: 'no_response', error: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) return { kind: 'no_response', error: 'unreadable response body' };
  }
  return parseSendBody(res.status, body);
}

async function expoReceipts(ids: string[]): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('reminders-dispatch: getReceipts HTTP', res.status);
      return null;
    }
    const body = (await res.json()) as { data?: unknown };
    return body?.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : null;
  } catch (e) {
    console.warn('reminders-dispatch: getReceipts failed', e instanceof Error ? e.name : '');
    return null;
  }
}

// ── sending + recording ────────────────────────────────────────────────

/** One delivery row to push now. */
type Outgoing = {
  deliveryId: string;
  installationId: string;
  token: string;
  slotAt: string;
  /** Counting this attempt. */
  attempts: number;
  message: ExpoMessage;
};

/** A delivery's recorded send outcome (`ticketId` when Expo accepted it). */
type Recorded = { status: string; error?: string; ticketId?: string };

/** Pushes the rows and records each outcome. Returns the final status per delivery id. */
async function sendAndRecord(db: SupabaseClient, outgoing: Outgoing[], summary: Summary | null): Promise<Map<string, Recorded>> {
  const final = new Map<string, Recorded>();
  for (const part of chunk(outgoing, EXPO_SEND_CHUNK)) {
    const result = await expoSend(part.map((o) => o.message));
    const outcomes = outcomesForSend(result, part.length);
    if (summary) summary.sent += part.length;
    await Promise.all(part.map((o, i) => recordOutcome(db, o, outcomes[i], summary).then((s) => final.set(o.deliveryId, s))));
  }
  return final;
}

async function recordOutcome(
  db: SupabaseClient,
  o: Outgoing,
  outcome: MessageOutcome,
  summary: Summary | null
): Promise<Recorded> {
  const now = new Date();
  let update: Record<string, unknown>;
  let status: string;
  let error: string | undefined;
  let ticketId: string | undefined;
  switch (outcome.status) {
    case 'accepted':
      status = 'accepted';
      ticketId = outcome.ticketId;
      update = { status, expo_ticket_id: outcome.ticketId, error: null, next_attempt_at: null };
      if (summary) summary.accepted++;
      break;
    case 'failed':
      status = 'failed';
      error = outcome.error;
      update = { status, error, next_attempt_at: null };
      if (summary) summary.failed++;
      if (outcome.disableInstallation) await disableInstallation(db, o.installationId, o.token, outcome.error);
      break;
    case 'uncertain':
      // Not retried: it may already be on the phone.
      status = 'uncertain';
      error = outcome.error;
      update = { status, error, next_attempt_at: null };
      if (summary) summary.uncertain++;
      break;
    case 'error':
    case 'retry': {
      error = outcome.error;
      const decision = retryDecision(o.attempts, new Date(o.slotAt), now);
      status = decision.status;
      update = decision.status === 'error' ? { status, error, next_attempt_at: decision.nextAttemptAt } : { status, error, next_attempt_at: null };
      if (summary) {
        if (decision.status === 'error') summary.errors++;
        else summary.failed++;
      }
      break;
    }
  }
  const { error: dbError } = await db
    .from('reminder_deliveries')
    .update({ ...update, attempts: o.attempts })
    .eq('id', o.deliveryId);
  if (dbError) logError('reminders-dispatch could not record a delivery:', dbError);
  if (ticketId) return { status, ticketId };
  return error ? { status, error } : { status };
}

async function disableInstallation(db: SupabaseClient, installationId: string, token: string, reason: string): Promise<void> {
  // Only while it still has the token Expo rejected -- a fresh registration since then stays enabled.
  const { error } = await db
    .from('push_installations')
    .update({ enabled: false, last_error: reason.slice(0, 300) })
    .eq('installation_id', installationId)
    .eq('expo_push_token', token);
  if (error) logError('reminders-dispatch could not disable an installation:', error);
}

// ── cron ───────────────────────────────────────────────────────────────

type Claimed = {
  reminder_id: string;
  user_id: string;
  slot_at: string;
  target_type: 'task' | 'session' | 'memory';
  target_id: string;
  kind: string;
  purpose: string;
  title: string;
  note: string | null;
  stale: boolean;
};

type LiveReminder = {
  id: string;
  user_id: string;
  status: string;
  next_fire_at: string | null;
  snoozed_until: string | null;
  suppressed_until: string | null;
  task_id: string | null;
  session_id: string | null;
  memory_id: string | null;
  purpose: string;
  title: string;
  note: string | null;
};

type Install = { installation_id: string; user_id: string; expo_push_token: string };

/** Live state for a set of reminders: the rules, their targets, their users' settings and installs. */
async function loadLive(db: SupabaseClient, reminderIds: string[], userIds: string[]) {
  const reminders = new Map<string, LiveReminder>();
  const tasks = new Map<string, { user_id: string; status: string; due_date: string | null; title: string }>();
  const existing = new Set<string>(); // "session:<id>" / "memory:<id>" that still exist (owner-checked)
  const profiles = new Map<string, { timezone: string; preview: boolean }>();
  const installs = new Map<string, Install[]>();
  if (reminderIds.length === 0) return { reminders, tasks, existing, profiles, installs };

  const [remRes, profRes, instRes] = await Promise.all([
    db
      .from('reminders')
      .select('id, user_id, status, next_fire_at, snoozed_until, suppressed_until, task_id, session_id, memory_id, purpose, title, note')
      .in('id', reminderIds),
    db.from('profiles').select('id, timezone, reminder_preview').in('id', userIds),
    db
      .from('push_installations')
      .select('installation_id, user_id, expo_push_token')
      .in('user_id', userIds)
      .eq('enabled', true)
      .not('expo_push_token', 'is', null),
  ]);
  if (remRes.error) throw remRes.error;
  if (profRes.error) throw profRes.error;
  if (instRes.error) throw instRes.error;
  for (const r of (remRes.data ?? []) as LiveReminder[]) reminders.set(r.id, r);
  for (const p of profRes.data ?? []) {
    profiles.set(p.id, { timezone: validTz(p.timezone), preview: p.reminder_preview !== false });
  }
  for (const i of (instRes.data ?? []) as Install[]) {
    const list = installs.get(i.user_id) ?? [];
    list.push(i);
    installs.set(i.user_id, list);
  }

  const live = [...reminders.values()];
  const taskIds = [...new Set(live.map((r) => r.task_id).filter((x): x is string => !!x))];
  const sessionIds = [...new Set(live.map((r) => r.session_id).filter((x): x is string => !!x))];
  const memoryIds = [...new Set(live.map((r) => r.memory_id).filter((x): x is string => !!x))];
  const [taskRes, sessRes, memRes] = await Promise.all([
    taskIds.length ? db.from('tasks').select('id, user_id, status, due_date, title').in('id', taskIds) : Promise.resolve({ data: [], error: null }),
    sessionIds.length ? db.from('sessions').select('id, user_id').in('id', sessionIds) : Promise.resolve({ data: [], error: null }),
    memoryIds.length ? db.from('memories').select('id, user_id').in('id', memoryIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (taskRes.error) throw taskRes.error;
  if (sessRes.error) throw sessRes.error;
  if (memRes.error) throw memRes.error;
  for (const t of (taskRes.data ?? []) as { id: string; user_id: string; status: string; due_date: string | null; title: string }[]) {
    tasks.set(t.id, { user_id: t.user_id, status: t.status, due_date: t.due_date ? String(t.due_date).slice(0, 10) : null, title: t.title });
  }
  for (const s of (sessRes.data ?? []) as { id: string; user_id: string }[]) existing.add(`session:${s.id}:${s.user_id}`);
  for (const m of (memRes.data ?? []) as { id: string; user_id: string }[]) existing.add(`memory:${m.id}:${m.user_id}`);
  return { reminders, tasks, existing, profiles, installs };
}

type Live = Awaited<ReturnType<typeof loadLive>>;

function validTz(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return Date.parse(a) === Date.parse(b);
}

/** Is this rule's target still there, still the user's, and (for a task) still open? */
function targetAlive(live: Live, r: LiveReminder): boolean {
  if (r.task_id) {
    const t = live.tasks.get(r.task_id);
    return !!t && t.user_id === r.user_id && t.status === 'open';
  }
  if (r.session_id) return live.existing.has(`session:${r.session_id}:${r.user_id}`);
  if (r.memory_id) return live.existing.has(`memory:${r.memory_id}:${r.user_id}`);
  return false;
}

function pushTextFor(live: Live, r: LiveReminder, slotAt: string) {
  const profile = live.profiles.get(r.user_id) ?? { timezone: 'UTC', preview: true };
  const task = r.task_id ? live.tasks.get(r.task_id) : undefined;
  return buildPushText({
    targetType: r.task_id ? 'task' : r.session_id ? 'session' : 'memory',
    purpose: r.purpose,
    title: task?.title ?? r.title,
    note: r.note,
    dueDate: task?.due_date ?? null,
    slotDate: localDateOf(new Date(slotAt), profile.timezone),
    preview: profile.preview,
  });
}

async function markFired(db: SupabaseClient, reminderId: string, slotAt: string): Promise<void> {
  const { error } = await db.rpc('reminders_mark_fired', { p_reminder_id: reminderId, p_slot: slotAt });
  // The lease expires on its own; the slot is then claimed again and the
  // delivery rows (already there) keep it from being pushed twice.
  if (error) logError('reminders-dispatch mark_fired failed:', error);
}

async function runCron(): Promise<Summary> {
  const started = Date.now();
  const db = serviceClient();
  const summary = emptySummary();

  while (Date.now() - started < CLAIM_BUDGET_MS) {
    const { data, error } = await db.rpc('reminders_claim_due', { p_limit: CLAIM_BATCH, p_lease_seconds: LEASE_SECONDS });
    if (error) throw error;
    const claimed = (data ?? []) as Claimed[];
    if (claimed.length === 0) break;
    summary.claimed += claimed.length;
    await handleClaimed(db, claimed, summary);
    if (claimed.length < CLAIM_BATCH) break;
  }

  if (Date.now() - started < PASSES_BUDGET_MS) await retryPass(db, summary);
  if (Date.now() - started < PASSES_BUDGET_MS) await receiptPass(db, summary);
  if (Date.now() - started < PASSES_BUDGET_MS) await audioRetentionPass(db);
  summary.ms = Date.now() - started;
  return summary;
}

async function handleClaimed(db: SupabaseClient, claimed: Claimed[], summary: Summary): Promise<void> {
  const live = await loadLive(
    db,
    claimed.map((c) => c.reminder_id),
    [...new Set(claimed.map((c) => c.user_id))]
  );
  const outgoing: Outgoing[] = [];
  const handled: Claimed[] = [];

  for (const c of claimed) {
    handled.push(c);
    const r = live.reminders.get(c.reminder_id);
    // Changed since it was claimed (done, stopped, snoozed, re-dated, deleted)?
    if (!r || r.user_id !== c.user_id || r.status !== 'active' || !sameInstant(r.next_fire_at, c.slot_at) || !targetAlive(live, r)) {
      summary.skipped++;
      continue;
    }
    if (c.stale) {
      summary.stale++;
      continue;
    }
    const devices = live.installs.get(c.user_id) ?? [];
    if (devices.length === 0) {
      summary.noDevices++;
      continue;
    }
    const key = targetKey(c.target_type, c.target_id);
    const { data: inserted, error } = await db
      .from('reminder_deliveries')
      .upsert(
        devices.map((d) => ({
          user_id: c.user_id,
          reminder_id: c.reminder_id,
          target_key: key,
          slot_at: c.slot_at,
          installation_id: d.installation_id,
          status: 'pending',
          attempts: 0,
        })),
        { onConflict: 'installation_id,target_key,slot_at', ignoreDuplicates: true }
      )
      .select('id, installation_id');
    if (error) {
      // Not marked fired below: the lease runs out and it is tried again.
      logError('reminders-dispatch could not write deliveries:', error);
      handled.pop();
      continue;
    }
    const rows = (inserted ?? []) as { id: string; installation_id: string }[];
    summary.duplicates += devices.length - rows.length;
    if (rows.length === 0) continue;
    const text = pushTextFor(live, r, c.slot_at);
    const data = { type: 'reminder', targetType: c.target_type, targetId: c.target_id, reminderId: c.reminder_id, slot: c.slot_at };
    for (const row of rows) {
      const device = devices.find((d) => d.installation_id === row.installation_id);
      if (!device) continue;
      outgoing.push({
        deliveryId: row.id,
        installationId: device.installation_id,
        token: device.expo_push_token,
        slotAt: c.slot_at,
        attempts: 1,
        message: buildExpoMessage(device.expo_push_token, text, data),
      });
    }
  }

  if (outgoing.length > 0) await sendAndRecord(db, outgoing, summary);
  // Every handled slot moves on -- pushed, skipped, stale or with no device.
  for (const part of chunk(handled, 10)) {
    await Promise.all(part.map((c) => markFired(db, c.reminder_id, c.slot_at)));
  }
}

type RetryRow = {
  id: string;
  user_id: string;
  reminder_id: string | null;
  target_key: string;
  slot_at: string;
  installation_id: string;
  attempts: number;
  next_attempt_at: string;
};

async function retryPass(db: SupabaseClient, summary: Summary): Promise<void> {
  const now = new Date();
  // A run that died between writing a row and recording Expo's answer: we
  // can't know whether it went out, so it is not sent again.
  const { data: stuck, error: stuckError } = await db
    .from('reminder_deliveries')
    .update({ status: 'uncertain', error: 'dispatcher stopped before recording the result' })
    .eq('status', 'pending')
    .lt('created_at', new Date(now.getTime() - STUCK_PENDING_MS).toISOString())
    .select('id');
  if (stuckError) logError('reminders-dispatch could not settle stuck rows:', stuckError);
  summary.stuckPending += stuck?.length ?? 0;

  const { data, error } = await db
    .from('reminder_deliveries')
    .select('id, user_id, reminder_id, target_key, slot_at, installation_id, attempts, next_attempt_at')
    .eq('status', 'error')
    .lte('next_attempt_at', now.toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(RETRY_BATCH);
  if (error) throw error;
  const rows = (data ?? []) as RetryRow[];
  if (rows.length === 0) return;

  const reminderIds = [...new Set(rows.map((r) => r.reminder_id).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const live = await loadLive(db, reminderIds, userIds);
  // Test pushes have no reminder; their installs are loaded separately.
  const installsByUser = live.installs;
  if (reminderIds.length === 0) {
    const { data: inst, error: instError } = await db
      .from('push_installations')
      .select('installation_id, user_id, expo_push_token')
      .in('user_id', userIds)
      .eq('enabled', true)
      .not('expo_push_token', 'is', null);
    if (instError) throw instError;
    for (const i of (inst ?? []) as Install[]) {
      const list = installsByUser.get(i.user_id) ?? [];
      list.push(i);
      installsByUser.set(i.user_id, list);
    }
  }

  const outgoing: Outgoing[] = [];
  for (const row of rows) {
    const giveUp = now.getTime() >= Date.parse(row.slot_at) + GIVE_UP_AFTER_MS;
    const device = (installsByUser.get(row.user_id) ?? []).find((d) => d.installation_id === row.installation_id);
    let reason: string | null = null;
    let text: { title: string; body: string };
    let data: Record<string, unknown>;
    if (row.reminder_id) {
      const r = live.reminders.get(row.reminder_id);
      if (!r || r.user_id !== row.user_id || r.status !== 'active' || !targetAlive(live, r)) reason = 'no longer due';
      else if (r.snoozed_until && Date.parse(r.snoozed_until) > now.getTime()) reason = 'snoozed since';
      else if (r.suppressed_until && Date.parse(r.suppressed_until) > now.getTime()) reason = 'not today';
      const [targetType, targetId] = row.target_key.split(':');
      text = r ? pushTextFor(live, r, row.slot_at) : { title: '', body: '' };
      data = { type: 'reminder', targetType, targetId, reminderId: row.reminder_id, slot: row.slot_at };
    } else {
      text = TEST_TEXT;
      data = { type: 'reminder_test' };
    }
    if (!device) reason = reason ?? 'installation disabled';

    if (giveUp || reason) {
      const { error: e } = await db
        .from('reminder_deliveries')
        .update(giveUp && !reason ? { status: 'failed', next_attempt_at: null } : { status: 'skipped', error: reason, next_attempt_at: null })
        .eq('id', row.id)
        .eq('status', 'error');
      if (e) logError('reminders-dispatch could not settle a retry:', e);
      summary.retrySkipped++;
      continue;
    }
    // Take the row (another overlapping run may be looking at it too).
    const { data: taken, error: takeError } = await db
      .from('reminder_deliveries')
      .update({ next_attempt_at: null })
      .eq('id', row.id)
      .eq('status', 'error')
      .eq('next_attempt_at', row.next_attempt_at)
      .select('id');
    if (takeError) {
      logError('reminders-dispatch could not take a retry:', takeError);
      continue;
    }
    if (!taken || taken.length === 0) continue;
    outgoing.push({
      deliveryId: row.id,
      installationId: device!.installation_id,
      token: device!.expo_push_token,
      slotAt: row.slot_at,
      attempts: row.attempts + 1,
      message: buildExpoMessage(device!.expo_push_token, text, data),
    });
  }
  summary.retried += outgoing.length;
  if (outgoing.length > 0) await sendAndRecord(db, outgoing, summary);
}

/**
 * Deletes original recordings past their owner's retention period
 * (profiles.audio_retention_days -- see 20261003000001_keep_audio.sql). Not
 * a reminder job; it rides on this per-minute cron so it needs no schedule
 * of its own. A failure only leaves the files for the next run.
 */
async function audioRetentionPass(db: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await db.rpc('audio_retention_expired', { p_limit: 200 });
    if (error) throw error;
    const rows = (data ?? []) as { id: string; storage_path: string }[];
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error: removeError } = await db.storage.from('recordings').remove(batch.map((r) => r.storage_path));
      if (removeError) throw removeError;
      const { error: deleteError } = await db
        .from('attachments')
        .delete()
        .in(
          'id',
          batch.map((r) => r.id)
        );
      if (deleteError) throw deleteError;
    }
  } catch (e) {
    const err = e as { message?: unknown } | null;
    console.warn('audio retention pass failed:', typeof err?.message === 'string' ? err.message.slice(0, 200) : '');
  }
}

async function receiptPass(db: SupabaseClient, summary: Summary): Promise<void> {
  const now = Date.now();
  const { data, error } = await db
    .from('reminder_deliveries')
    .select('id, expo_ticket_id, installation_id, created_at')
    .eq('status', 'accepted')
    .is('receipt_checked_at', null)
    .lt('created_at', new Date(now - RECEIPT_DELAY_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(RECEIPT_BATCH);
  if (error) throw error;
  const rows = ((data ?? []) as { id: string; expo_ticket_id: string | null; installation_id: string; created_at: string }[]).filter(
    (r): r is ReceiptRow => !!r.expo_ticket_id
  );
  const checkedAt = new Date().toISOString();
  for (const part of chunk(rows, EXPO_RECEIPT_CHUNK)) {
    const receipts = await expoReceipts(part.map((r) => r.expo_ticket_id));
    if (!receipts) continue; // try again next run
    const outcomes = await recordReceipts(db, part, receipts, checkedAt, summary);
    const expired = part
      .filter((r) => outcomes.get(r.id)?.status === 'pending' && now - Date.parse(r.created_at) > RECEIPT_GIVE_UP_MS)
      .map((r) => r.id);
    if (expired.length > 0) {
      // No receipt any more: stays 'accepted' (Expo took it; the rest is unknown).
      const { error: e } = await db.from('reminder_deliveries').update({ receipt_checked_at: checkedAt }).in('id', expired);
      if (e) logError('reminders-dispatch could not close old receipts:', e);
    }
  }
}

/** An accepted delivery whose push receipt is to be checked. */
type ReceiptRow = { id: string; expo_ticket_id: string; installation_id: string; created_at: string };

/**
 * Records one batch of Expo receipts on their delivery rows: 'delivered' or
 * 'failed' (and disables an install Expo reports as DeviceNotRegistered).
 * Rows with no receipt yet are left as they are. Shared by the cron's
 * receipt pass and the test push; returns each row's outcome by delivery id.
 */
async function recordReceipts(
  db: SupabaseClient,
  rows: ReceiptRow[],
  receipts: Record<string, unknown>,
  checkedAt: string,
  summary: Summary | null
): Promise<Map<string, ReceiptOutcome>> {
  const outcomes = new Map<string, ReceiptOutcome>();
  const delivered: string[] = [];
  for (const row of rows) {
    const outcome = classifyReceipt(receipts[row.expo_ticket_id]);
    outcomes.set(row.id, outcome);
    if (summary) summary.receiptsChecked++;
    if (outcome.status === 'delivered') {
      // Handed to FCM/APNs -- NOT proof the phone showed it or the user saw it.
      delivered.push(row.id);
    } else if (outcome.status === 'failed') {
      if (summary) summary.receiptFailed++;
      const { error: e } = await db
        .from('reminder_deliveries')
        .update({ status: 'failed', error: outcome.error, receipt_checked_at: checkedAt })
        .eq('id', row.id);
      if (e) logError('reminders-dispatch could not record a receipt:', e);
      if (outcome.disableInstallation) {
        // Only if the install hasn't re-registered since this push went out.
        const { error: d } = await db
          .from('push_installations')
          .update({ enabled: false, last_error: outcome.error })
          .eq('installation_id', row.installation_id)
          .lt('updated_at', row.created_at);
        if (d) logError('reminders-dispatch could not disable an installation:', d);
      }
    }
  }
  if (delivered.length > 0) {
    if (summary) summary.delivered += delivered.length;
    const { error: e } = await db
      .from('reminder_deliveries')
      .update({ status: 'delivered', receipt_checked_at: checkedAt })
      .in('id', delivered);
    if (e) logError('reminders-dispatch could not record receipts:', e);
  }
  return outcomes;
}

// ── test push ──────────────────────────────────────────────────────────

const TEST_TEXT = { title: 'Test notification', body: 'Reminders will show up like this.' };

/**
 * Pushes to the caller's usable installs and reports what really happened.
 * `askingInstall` is the phone that pressed the button (optional): `reason`
 * then says why THAT phone got nothing, even when another device got it;
 * without it, `reason` only comes with "no device at all".
 */
async function runTest(userId: string, askingInstall: string | null) {
  const db = serviceClient();
  const { data, error } = await db
    .from('push_installations')
    .select('installation_id, expo_push_token, permission, enabled, last_error, last_seen_at')
    .eq('user_id', userId);
  if (error) throw error;
  const all = (data ?? []) as InstallationState[];
  const devices = all.filter(isUsableInstallation) as (InstallationState & { expo_push_token: string })[];
  const why = devices.length === 0 || askingInstall ? testNoDeviceReason(all, askingInstall) : null;
  const explain = why ? (why.lastError ? { reason: why.reason, lastError: why.lastError } : { reason: why.reason }) : {};
  if (devices.length === 0) {
    console.log('[reminders-dispatch] test', JSON.stringify({ installs: all.length, usable: 0, reason: why?.reason }));
    return { installations: 0, sent: 0, results: [], ...explain };
  }

  const slot = truncateToSecond(new Date());
  const key = `test:${userId}`;
  const { data: inserted, error: insertError } = await db
    .from('reminder_deliveries')
    .upsert(
      devices.map((d) => ({
        user_id: userId,
        reminder_id: null,
        target_key: key,
        slot_at: slot,
        installation_id: d.installation_id,
        status: 'pending',
        attempts: 0,
      })),
      { onConflict: 'installation_id,target_key,slot_at', ignoreDuplicates: true }
    )
    .select('id, installation_id, created_at');
  if (insertError) throw insertError;
  const rows = (inserted ?? []) as { id: string; installation_id: string; created_at: string }[];
  const outgoing: Outgoing[] = [];
  for (const row of rows) {
    const d = devices.find((x) => x.installation_id === row.installation_id);
    if (!d) continue;
    outgoing.push({
      deliveryId: row.id,
      installationId: d.installation_id,
      token: d.expo_push_token,
      slotAt: slot,
      attempts: 1,
      message: buildExpoMessage(d.expo_push_token, TEST_TEXT, { type: 'reminder_test' }),
    });
  }
  const final = outgoing.length > 0 ? await sendAndRecord(db, outgoing, null) : new Map<string, Recorded>();

  // What FCM/APNs said about the accepted ones, if they answer within a few seconds.
  const receiptRows: ReceiptRow[] = [];
  for (const row of rows) {
    const ticketId = final.get(row.id)?.ticketId;
    if (ticketId) receiptRows.push({ id: row.id, expo_ticket_id: ticketId, installation_id: row.installation_id, created_at: row.created_at });
  }
  const receipts = receiptRows.length > 0 ? await awaitTestReceipts(db, receiptRows) : new Map<string, ReceiptOutcome>();

  const results = outgoing.map((o) =>
    testResultItem(o.installationId, final.get(o.deliveryId) ?? { status: 'pending' }, receipts.get(o.deliveryId))
  );
  console.log(
    '[reminders-dispatch] test',
    JSON.stringify({
      installs: all.length,
      usable: devices.length,
      reason: why?.reason,
      results: results.map((r) => [r.status, logSafe(r.error), r.receipt ?? null]),
    })
  );
  return { installations: devices.length, sent: outgoing.length, results, ...explain };
}

/**
 * Polls the receipts of a just-sent test push a few times (TEST_RECEIPT_POLL_MS)
 * and records each one that arrives, exactly as the cron's receipt pass would
 * -- so that pass never processes it again. Rows still without a receipt
 * stay 'accepted' for the cron to check later.
 */
async function awaitTestReceipts(db: SupabaseClient, rows: ReceiptRow[]): Promise<Map<string, ReceiptOutcome>> {
  const settled = new Map<string, ReceiptOutcome>();
  let waiting = rows;
  for (const delay of TEST_RECEIPT_POLL_MS) {
    if (waiting.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    for (const part of chunk(waiting, EXPO_RECEIPT_CHUNK)) {
      const receipts = await expoReceipts(part.map((r) => r.expo_ticket_id));
      if (!receipts) continue; // try again on the next round
      const outcomes = await recordReceipts(db, part, receipts, new Date().toISOString(), null);
      for (const [id, outcome] of outcomes) if (outcome.status !== 'pending') settled.set(id, outcome);
    }
    waiting = waiting.filter((r) => !settled.has(r.id));
  }
  return settled;
}

// ── misc ───────────────────────────────────────────────────────────────

/** An Expo error code for the logs; a message that quotes a token ("ExponentPushToken[...]") gets it masked. */
function logSafe(error: string | undefined): string | null {
  return error ? error.replace(/\S*\[[^\]]*\]\S*/g, '[token]').slice(0, 120) : null;
}

/** Code and message only -- never tokens or reminder content. */
function logError(what: string, e: unknown): void {
  const err = e as { code?: unknown; message?: unknown } | null;
  console.error(what, err?.code ?? '', typeof err?.message === 'string' ? err.message.slice(0, 300) : '');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
