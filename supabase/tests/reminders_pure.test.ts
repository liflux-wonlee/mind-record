// Unit tests for the pure reminder modules in supabase/functions/_shared
// (no Deno, no network, no database). Run with Node 22+ (type stripping):
//
//   node --test supabase/tests/reminders_pure.test.ts
//
// The database side (scheduling, agenda, claim/mark) is covered by
// supabase/tests/reminders_test.sql.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  briefingHashInput,
  emptyScript,
  itemLine,
  primaryLang,
  templateScript,
  type BriefingItem,
} from '../functions/_shared/briefingText.ts';
import {
  buildExpoMessage,
  buildPushText,
  chunk,
  classifyReceipt,
  classifyTicket,
  GIVE_UP_AFTER_MS,
  MAX_ATTEMPTS,
  outcomesForSend,
  parseSendBody,
  retryDecision,
  timingSafeEqual,
  truncateToSecond,
} from '../functions/_shared/reminderPush.ts';
import {
  addDays,
  inQuietHours,
  instantInMinutes,
  leadDueDate,
  leadNote,
  localDateOf,
  localTimeOf,
  normalizeHm,
  sanitizeReminderRequest,
  spokenWhen,
  validateReminderDate,
  zonedToInstant,
} from '../functions/_shared/reminderRules.ts';

describe('push text', () => {
  const base = {
    targetType: 'task' as const,
    purpose: 'remind',
    title: "Order Mom's gift",
    note: null,
    dueDate: '2026-10-11',
    slotDate: '2026-10-11',
    preview: true,
  };
  test('due today / tomorrow / overdue / plain', () => {
    assert.equal(buildPushText(base).title, 'Due today');
    assert.equal(buildPushText({ ...base, slotDate: '2026-10-10' }).title, 'Due tomorrow');
    assert.equal(buildPushText({ ...base, slotDate: '2026-10-12' }).title, 'Overdue');
    assert.equal(buildPushText({ ...base, slotDate: '2026-10-01' }).title, 'Reminder');
    assert.equal(buildPushText({ ...base, dueDate: null }).title, 'Reminder');
    assert.equal(buildPushText({ ...base, targetType: 'session', dueDate: null }).title, 'Reminder');
    assert.equal(buildPushText(base).body, "Order Mom's gift");
  });
  test('month boundary: due Nov 1, slot Oct 31 -> tomorrow', () => {
    assert.equal(buildPushText({ ...base, dueDate: '2026-11-01', slotDate: '2026-10-31' }).title, 'Due tomorrow');
  });
  test('waiting for a reply', () => {
    assert.equal(buildPushText({ ...base, purpose: 'waiting' }).title, 'Check for a reply');
  });
  test('note is appended and long text clipped', () => {
    const t = buildPushText({ ...base, note: 'Birthday Wed 10/14 -> order by Sun 10/11' });
    assert.equal(t.body, "Order Mom's gift — Birthday Wed 10/14 -> order by Sun 10/11");
    const long = buildPushText({ ...base, title: 'x'.repeat(500), note: 'y'.repeat(500) });
    assert.ok(long.body.length <= 120 + 3 + 90);
  });
  test('preview off: nothing about the item', () => {
    const t = buildPushText({ ...base, preview: false, note: 'secret note' });
    assert.equal(t.title, 'Reminder');
    assert.ok(!t.body.includes('Mom'));
    assert.ok(!t.body.includes('secret'));
    assert.ok(!t.title.includes('Due'));
  });
  test('expo message shape', () => {
    const m = buildExpoMessage('ExponentPushToken[x]', { title: 'a', body: 'b' }, { type: 'reminder' });
    assert.equal(m.channelId, 'reminders');
    assert.equal(m.priority, 'high');
    assert.equal(m.sound, 'default');
    assert.equal(m.ttl, 6 * 3600);
  });
});

describe('chunking', () => {
  test('sizes', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    assert.deepEqual(chunk(items, 100).map((c) => c.length), [100, 100, 50]);
    assert.deepEqual(chunk([], 100), []);
    assert.deepEqual(chunk(Array.from({ length: 600 }, (_, i) => i), 300).map((c) => c.length), [300, 300]);
    assert.throws(() => chunk([1], 0));
  });
});

describe('tickets, receipts and sends', () => {
  test('ticket classification', () => {
    assert.deepEqual(classifyTicket({ status: 'ok', id: 'abc' }), { status: 'accepted', ticketId: 'abc' });
    const dnr = classifyTicket({ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } });
    assert.equal(dnr.status, 'failed');
    assert.equal(dnr.status === 'failed' && dnr.disableInstallation, true);
    const big = classifyTicket({ status: 'error', details: { error: 'MessageTooBig' } });
    assert.equal(big.status, 'failed');
    assert.equal(big.status === 'failed' && big.disableInstallation, false);
    assert.equal(classifyTicket({ status: 'error', details: { error: 'MessageRateExceeded' } }).status, 'error');
    assert.equal(classifyTicket(null).status, 'error');
    assert.equal(classifyTicket({ status: 'ok' }).status, 'error'); // ok without an id is not an acceptance
  });
  test('receipt classification: delivered is only "handed to FCM/APNs"', () => {
    assert.deepEqual(classifyReceipt({ status: 'ok' }), { status: 'delivered' });
    const r = classifyReceipt({ status: 'error', details: { error: 'DeviceNotRegistered' } });
    assert.equal(r.status === 'failed' && r.disableInstallation, true);
    const other = classifyReceipt({ status: 'error', details: { error: 'MessageRateExceeded' } });
    assert.equal(other.status === 'failed' && other.disableInstallation, false);
    assert.deepEqual(classifyReceipt(undefined), { status: 'pending' });
  });
  test('send results', () => {
    assert.deepEqual(parseSendBody(200, { data: [{ status: 'ok', id: '1' }] }), { kind: 'tickets', tickets: [{ status: 'ok', id: '1' }] });
    assert.equal(parseSendBody(400, { errors: [{ code: 'VALIDATION_ERROR' }] }).kind, 'http_error');
    assert.equal(parseSendBody(503, null).kind, 'http_error');
    assert.equal(parseSendBody(200, {}).kind, 'no_response');

    const http = outcomesForSend({ kind: 'http_error', status: 500, error: 'x' }, 2);
    assert.deepEqual(http.map((o) => o.status), ['retry', 'retry']);
    // No answer at all: never retried (it may already be on the phone).
    const none = outcomesForSend({ kind: 'no_response', error: 'timeout' }, 3);
    assert.deepEqual(none.map((o) => o.status), ['uncertain', 'uncertain', 'uncertain']);
    const mismatch = outcomesForSend({ kind: 'tickets', tickets: [{ status: 'ok', id: '1' }] }, 2);
    assert.deepEqual(mismatch.map((o) => o.status), ['uncertain', 'uncertain']);
    const mixed = outcomesForSend(
      { kind: 'tickets', tickets: [{ status: 'ok', id: '1' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] },
      2
    );
    assert.deepEqual(mixed.map((o) => o.status), ['accepted', 'failed']);
  });
});

describe('retry schedule', () => {
  const slot = new Date('2026-10-01T13:00:00Z');
  test('backoff 30s, 2m, then give up after MAX_ATTEMPTS', () => {
    const now = new Date('2026-10-01T13:00:10Z');
    const a1 = retryDecision(1, slot, now);
    assert.equal(a1.status, 'error');
    assert.equal(a1.status === 'error' && a1.nextAttemptAt, '2026-10-01T13:00:40.000Z');
    const a2 = retryDecision(2, slot, now);
    assert.equal(a2.status === 'error' && a2.nextAttemptAt, '2026-10-01T13:02:10.000Z');
    assert.equal(retryDecision(MAX_ATTEMPTS, slot, now).status, 'failed');
  });
  test('give up once the slot is 30 minutes old', () => {
    assert.equal(retryDecision(1, slot, new Date(slot.getTime() + GIVE_UP_AFTER_MS)).status, 'failed');
    // a retry that would land past the deadline is not scheduled
    assert.equal(retryDecision(2, slot, new Date(slot.getTime() + GIVE_UP_AFTER_MS - 60_000)).status, 'failed');
  });
});

describe('misc push helpers', () => {
  test('constant-time compare', () => {
    assert.equal(timingSafeEqual('secret', 'secret'), true);
    assert.equal(timingSafeEqual('secret', 'secreT'), false);
    assert.equal(timingSafeEqual('secret', 'secret2'), false);
    assert.equal(timingSafeEqual('', ''), true);
  });
  test('slot truncated to the second', () => {
    assert.equal(truncateToSecond(new Date('2026-10-01T13:00:05.987Z')), '2026-10-01T13:00:05.000Z');
  });
});

describe('dates and lead time', () => {
  test('lead due date = event - N calendar days', () => {
    const r = leadDueDate('2026-10-14', 3, '2026-10-04');
    assert.ok(!('error' in r));
    if (!('error' in r)) {
      assert.equal(r.dueDate, '2026-10-11'); // Wed -> Sun
      assert.equal(r.late, false);
      assert.equal(leadNote(r), 'Wed 10/14 -> by Sun 10/11 (3 days before)');
    }
  });
  test('across month / year ends and leap day', () => {
    const due = (e: string, n: number) => {
      const r = leadDueDate(e, n, '2026-10-01');
      return 'error' in r ? r.error : r.dueDate;
    };
    assert.equal(due('2026-11-02', 3), '2026-10-30');
    assert.equal(due('2027-01-01', 1), '2026-12-31');
    assert.equal(due('2028-03-01', 1), '2028-02-29');
    assert.equal(due('2027-03-01', 1), '2027-02-28');
    assert.equal(due('2026-10-14', 0), '2026-10-14');
  });
  test('a computed deadline in the past is kept and flagged late', () => {
    const r = leadDueDate('2026-10-01', 3, '2026-09-29');
    assert.ok(!('error' in r) && r.dueDate === '2026-09-28' && r.late === true);
  });
  test('bad lead input', () => {
    assert.ok('error' in leadDueDate('2026-02-30', 3, '2026-01-01'));
    assert.ok('error' in leadDueDate('2026-10-14', -1, '2026-01-01'));
    assert.ok('error' in leadDueDate('2026-10-14', 2.5, '2026-01-01'));
  });
  test('"in N minutes" -> absolute', () => {
    const now = new Date('2026-10-02T14:00:00Z');
    const r = instantInMinutes(now, 120);
    assert.ok('at' in r && r.at.toISOString() === '2026-10-02T16:00:00.000Z');
    assert.ok('error' in instantInMinutes(now, 0));
    assert.ok('error' in instantInMinutes(now, -5));
    assert.ok('error' in instantInMinutes(now, 1.5));
    assert.ok('error' in instantInMinutes(now, 60 * 24 * 365));
    assert.ok('error' in instantInMinutes(now, 'soon'));
  });
  test('date validation relative to today', () => {
    assert.equal(validateReminderDate('2026-10-02', '2026-10-02'), null);
    assert.equal(validateReminderDate('2026-10-03', '2026-10-02'), null);
    assert.match(validateReminderDate('2026-10-01', '2026-10-02') ?? '', /past/);
    assert.equal(validateReminderDate('2026-10-01', '2026-10-02', { allowPast: true }), null);
    assert.match(validateReminderDate('2026-02-30', '2026-01-01') ?? '', /real/);
    assert.match(validateReminderDate('10/14', '2026-01-01') ?? '', /real/);
    assert.match(validateReminderDate('2030-01-01', '2026-01-01') ?? '', /too far/);
  });
  test('addDays across month end', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });
  test('HH:MM normalization', () => {
    assert.equal(normalizeHm('9:05'), '09:05');
    assert.equal(normalizeHm('09:00:00'), '09:00');
    assert.equal(normalizeHm('24:00'), null);
    assert.equal(normalizeHm('noon'), null);
  });
});

describe('time zones (same answers as the database)', () => {
  test('local date + time -> instant, DST safe', () => {
    assert.equal(zonedToInstant('2026-10-02', '09:00', 'Asia/Seoul').toISOString(), '2026-10-02T00:00:00.000Z');
    assert.equal(zonedToInstant('2026-10-02', '09:00', 'America/New_York').toISOString(), '2026-10-02T13:00:00.000Z');
    assert.equal(zonedToInstant('2026-11-01', '09:00', 'America/New_York').toISOString(), '2026-11-01T14:00:00.000Z');
    // nonexistent (spring forward) and ambiguous (fall back) -- as Postgres does
    assert.equal(zonedToInstant('2027-03-14', '02:30', 'America/New_York').toISOString(), '2027-03-14T07:30:00.000Z');
    assert.equal(zonedToInstant('2026-11-01', '01:30', 'America/New_York').toISOString(), '2026-11-01T06:30:00.000Z');
  });
  test('instant -> local date/time', () => {
    const at = new Date('2026-10-01T16:30:00Z');
    assert.equal(localDateOf(at, 'Asia/Seoul'), '2026-10-02');
    assert.equal(localTimeOf(at, 'Asia/Seoul'), '01:30');
    assert.equal(localDateOf(at, 'America/New_York'), '2026-10-01');
  });
  test('spoken times', () => {
    const w = spokenWhen(new Date('2026-10-03T00:00:00Z'), 'Asia/Seoul', '2026-10-02');
    assert.equal(w.ko, '내일 오전 9시');
    assert.equal(w.en, 'tomorrow at 9:00 AM');
    const w2 = spokenWhen(new Date('2026-10-10T06:30:00Z'), 'Asia/Seoul', '2026-10-02');
    assert.equal(w2.ko, '10월 10일 오후 3시 30분');
    assert.equal(w2.en, 'Oct 10 at 3:30 PM');
  });
  test('quiet hours wrap midnight', () => {
    assert.equal(inQuietHours('23:00', '22:00', '08:00'), true);
    assert.equal(inQuietHours('07:59', '22:00', '08:00'), true);
    assert.equal(inQuietHours('08:00', '22:00', '08:00'), false);
    assert.equal(inQuietHours('13:00', '12:00', '14:00'), true);
    assert.equal(inQuietHours('13:00', null, '14:00'), false);
    assert.equal(inQuietHours('13:00', '10:00:00', '10:00:00'), false);
  });
});

describe('extracted reminder requests', () => {
  test('keeps well-formed ones only', () => {
    assert.equal(sanitizeReminderRequest({ type: 'at' }, { recordLevel: false }), null);
    assert.equal(sanitizeReminderRequest({ type: 'default' }, { recordLevel: true }), null);
    assert.equal(sanitizeReminderRequest({ type: 'context' }, { recordLevel: false }), null);
    assert.equal(sanitizeReminderRequest({ type: 'hourly' }, { recordLevel: false }), null);
    assert.equal(sanitizeReminderRequest({ type: 'in', minutes: 0 }, { recordLevel: false }), null);
    const at = sanitizeReminderRequest({ type: 'at', date: '2026-10-08', time: '9:30', purpose: 'waiting' }, { recordLevel: false });
    assert.equal(at?.time, '09:30');
    assert.equal(at?.purpose, 'waiting');
    const ctx = sanitizeReminderRequest({ type: 'context', context_tag: ' Home ' }, { recordLevel: false });
    assert.equal(ctx?.context_tag, 'home');
    const lead = sanitizeReminderRequest({ type: 'daily_until_done', event_date: '2026-10-14', lead_days: 3 }, { recordLevel: false });
    assert.equal(lead?.event_date, '2026-10-14');
    assert.equal(lead?.lead_days, 3);
    const rec = sanitizeReminderRequest({ type: 'at', date: '2026-11-02', event_date: '2026-10-14', lead_days: 3 }, { recordLevel: true });
    assert.equal(rec?.event_date, null);
  });
});

describe('briefing text', () => {
  const tz = 'Asia/Seoul';
  const today = '2026-10-11';
  const item = (i: number, over: Partial<BriefingItem> = {}): BriefingItem => ({
    index: i,
    targetType: 'task',
    targetId: `00000000-0000-4000-8000-00000000000${i}`,
    title: `Item ${i}`,
    reason: 'due_today',
    dueDate: today,
    note: null,
    purpose: 'remind',
    nextFireAt: null,
    ...over,
  });
  test('template: count, at most three items, never claims done, offers the rest', () => {
    const items = [item(1, { reason: 'overdue', dueDate: '2026-10-09' }), item(2, { note: '배송 준비 때문에 오늘 주문' }), item(3), item(4)];
    const ko = templateScript(items, 'ko', null, today, tz);
    assert.ok(ko.startsWith('오늘 챙길 것이 4개 있어요.'));
    assert.ok(ko.includes('첫째, Item 1, 기한 지남'));
    assert.ok(ko.includes('배송 준비 때문에 오늘 주문'));
    assert.ok(!ko.includes('Item 4'));
    assert.ok(ko.includes('아직 완료 표시는 없어요.'));
    assert.ok(ko.endsWith('나머지도 들으시겠어요?'));
    const en = templateScript(items.slice(0, 2), 'en', 'Won', today, tz);
    assert.ok(en.startsWith('Won, you have 2 things'));
    assert.ok(!/rest\?/.test(en));
    assert.ok(/not marked done|isn't marked done|None of these is marked done/.test(en));
  });
  test('empty day', () => {
    assert.equal(emptyScript('ko', null, 0), '오늘 챙길 건 없어요. 편안한 하루 보내세요.');
    assert.ok(emptyScript('en', null, 2).includes('2 more are set for later'));
  });
  test('item lines', () => {
    assert.equal(itemLine(item(1), 'en', today, tz), 'Item 1 · due today');
    assert.equal(itemLine(item(1, { purpose: 'waiting' }), 'ko', today, tz), 'Item 1 · 답변 왔는지 확인');
    assert.equal(
      itemLine(item(1, { reason: 'scheduled_today', nextFireAt: '2026-10-11T06:00:00Z' }), 'en', today, tz),
      'Item 1 · today at 3:00 PM'
    );
  });
  test('cache key changes with state, wording, voice and day', () => {
    const base = { today, tz, lang: 'ko', voice: 'alloy', aiName: null, honorific: null, laterCount: 0, items: [item(1)] };
    const h = briefingHashInput(base);
    assert.equal(h, briefingHashInput({ ...base }));
    assert.notEqual(h, briefingHashInput({ ...base, items: [item(1, { reason: 'overdue' })] }));
    assert.notEqual(h, briefingHashInput({ ...base, items: [item(1, { title: 'Renamed' })] }));
    assert.notEqual(h, briefingHashInput({ ...base, items: [] }));
    assert.notEqual(h, briefingHashInput({ ...base, voice: 'marin' }));
    assert.notEqual(h, briefingHashInput({ ...base, today: '2026-10-12' }));
  });
  test('language hint', () => {
    assert.equal(primaryLang('ko-KR'), 'ko');
    assert.equal(primaryLang('en'), 'en');
    assert.equal(primaryLang('!!'), null);
  });
});
