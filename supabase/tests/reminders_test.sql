-- Reminder scheduling tests. Run with scripts/test-reminders-sql.sh, which
-- creates a scratch database, applies supabase/tests/supabase_stubs.sql and
-- every migration, then this file. Any failed check raises and stops.
--
-- The clock is injected with `set reminders.now = '...'` (see reminder_now()).

\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end $$;

create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end $$;

-- Users: A in New York (DST), B in Seoul.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b@example.com');
update public.profiles set timezone = 'America/New_York' where id = 'aaaaaaaa-0000-4000-8000-000000000001';
update public.profiles set timezone = 'Asia/Seoul' where id = 'bbbbbbbb-0000-4000-8000-000000000002';

set reminders.now = '2026-09-29 12:00:00+00'; -- 08:00 in New York

-- ---------------------------------------------------------------------------
-- 1. Date-only task: day before + day of at 09:00 local.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Send quote', '2026-10-02');

select pg_temp.eq(
  (select count(*)::int from public.reminders where task_id = '11111111-0000-4000-8000-000000000001' and origin = 'default'),
  1, 'dated task gets one automatic reminder');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000001'),
  '2026-10-01 09:00:00 America/New_York'::timestamptz, 'first slot = day before, 09:00 local');

-- Handled slot -> next is the day of.
select pg_temp.as_service();
set reminders.now = '2026-10-01 13:00:30+00';
select pg_temp.eq((select count(*)::int from public.reminders_claim_due(100, 120)), 1, 'claim returns the due reminder');
select pg_temp.eq((select count(*)::int from public.reminders_claim_due(100, 120)), 0, 'a leased reminder is not claimed twice');
select pg_temp.eq(
  public.reminders_mark_fired(
    (select id from public.reminders where task_id = '11111111-0000-4000-8000-000000000001'),
    '2026-10-01 09:00:00 America/New_York'::timestamptz),
  '2026-10-02 09:00:00 America/New_York'::timestamptz, 'after firing: day-of slot');

-- ---------------------------------------------------------------------------
-- 2. DST: fall back (Nov 1 2026, New York) -- 09:00 local on both sides.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Across DST', '2026-11-02');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000002'),
  '2026-11-01 14:00:00+00'::timestamptz, 'day before on the fall-back day is 09:00 EST (14:00Z)');
-- spring forward (Mar 14 2027): the day before is still a calendar day (23h long)
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Spring', '2027-03-15');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000003'),
  '2027-03-14 13:00:00+00'::timestamptz, 'day before on spring-forward day is 09:00 EDT (13:00Z)');
-- a local time that doesn't exist that day (02:30 on spring-forward) still resolves to one instant
select pg_temp.eq(
  public.reminder_local_ts('2027-03-14', '02:30', 'America/New_York') is not null,
  true, 'nonexistent local time resolves');

-- Month boundary: due Oct 1 -> day before is Sep 30.
set reminders.now = '2026-09-29 12:00:00+00';
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'Month edge', '2026-10-01');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000004'),
  '2026-09-30 09:00:00 America/New_York'::timestamptz, 'day before across a month boundary');

-- ---------------------------------------------------------------------------
-- 3. Created late: due today, 09:00 already passed -> no slot, no burst,
--    but it is on today's list.
-- ---------------------------------------------------------------------------
set reminders.now = '2026-09-29 20:00:00+00'; -- 16:00 NY
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'Late today', '2026-09-29');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000005'),
  null::timestamptz, 'no past slots for a task created after its reminder times');
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000005'),
  'due_today', 'late task still listed for today');
-- A past-due task created now: overdue, and nothing is sent for the past.
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'Past due', '2026-09-20');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000006'),
  null::timestamptz, 'past-due task: no slots');
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000006'),
  'overdue', 'past-due task shows as overdue');

-- ---------------------------------------------------------------------------
-- 4. Completion / reopen / delete / date change / date removal.
-- ---------------------------------------------------------------------------
set reminders.now = '2026-09-29 12:00:00+00';
update public.tasks set status = 'completed', completed_at = now() where id = '11111111-0000-4000-8000-000000000004';
select pg_temp.eq(
  (select status || '/' || status_reason from public.reminders where task_id = '11111111-0000-4000-8000-000000000004'),
  'done/target_done', 'completing ends the reminders');
select pg_temp.eq(
  (select count(*)::int from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000004'),
  0, 'completed task is off the list');
-- reopen after its slots passed: nothing old re-sent
set reminders.now = '2026-10-01 18:00:00+00';
update public.tasks set status = 'open', completed_at = null where id = '11111111-0000-4000-8000-000000000004';
select pg_temp.eq(
  (select status from public.reminders where task_id = '11111111-0000-4000-8000-000000000004'),
  'active', 'reopen reactivates');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000004'),
  null::timestamptz, 'reopen after the due day: no past slot re-sent');

set reminders.now = '2026-09-29 12:00:00+00';
-- date change recomputes
update public.tasks set due_date = '2026-10-09' where id = '11111111-0000-4000-8000-000000000002';
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000002'),
  '2026-10-08 09:00:00 America/New_York'::timestamptz, 'new due date recomputes');
-- explicit once reminder on a task replaces the automatic one; removing the date keeps it
insert into public.reminders (user_id, task_id, kind, fire_at, title, timezone)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002', 'once', '2026-10-05 15:00:00 America/New_York', 'Across DST', 'America/New_York');
select pg_temp.eq(
  (select status_reason from public.reminders where task_id = '11111111-0000-4000-8000-000000000002' and origin = 'default'),
  'replaced', 'a user-set time replaces the automatic reminder');
update public.tasks set due_date = null where id = '11111111-0000-4000-8000-000000000002';
select pg_temp.eq(
  (select status from public.reminders where task_id = '11111111-0000-4000-8000-000000000002' and kind = 'once'),
  'active', 'removing the date keeps a separately set reminder');
-- delete cascades
delete from public.tasks where id = '11111111-0000-4000-8000-000000000002';
select pg_temp.eq(
  (select count(*)::int from public.reminders where task_id = '11111111-0000-4000-8000-000000000002'),
  0, 'deleting the task deletes its reminders');

-- ---------------------------------------------------------------------------
-- 5. Snooze / not today / stop -- due date untouched; list stays consistent.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set reminders.now = '2026-10-02 14:00:00+00'; -- 10:00 NY on the due day of task 1
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000001'),
  'due_today', 'task 1 due today');
select pg_temp.eq(
  (select effective_until from public.reminder_act('aaaaaaaa-0000-4000-8000-000000000001', 'task', '11111111-0000-4000-8000-000000000001', 'snooze', '2026-10-02 16:00:00+00')),
  '2026-10-02 16:00:00+00'::timestamptz, 'snooze two hours');
select pg_temp.eq(
  (select bucket || '/' || reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000001'),
  'later/snoozed', 'snoozed item moves to later');
select pg_temp.eq((select due_date from public.tasks where id = '11111111-0000-4000-8000-000000000001'), '2026-10-02'::date, 'snooze keeps the due date');
set reminders.now = '2026-10-02 16:00:01+00';
select pg_temp.eq(
  (select bucket from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000001'),
  'now', 'after the snooze time it is back in today');
-- snooze into quiet hours -> end of quiet hours
set reminders.now = '2026-10-02 01:00:00+00'; -- 21:00 NY Oct 1
select pg_temp.eq(
  (select effective_until from public.reminder_act('aaaaaaaa-0000-4000-8000-000000000001', 'task', '11111111-0000-4000-8000-000000000001', 'snooze', '2026-10-02 03:00:00+00')),
  '2026-10-02 08:00:00 America/New_York'::timestamptz, 'snooze into quiet hours lands at quiet end');

-- not today
set reminders.now = '2026-10-02 14:00:00+00';
select pg_temp.eq(
  (select effective_until from public.reminder_act('aaaaaaaa-0000-4000-8000-000000000001', 'task', '11111111-0000-4000-8000-000000000005', 'not_today')),
  '2026-10-03 00:00:00 America/New_York'::timestamptz, 'not today = until local midnight');
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000005'),
  'not_today', 'not-today item listed under later');

-- stop: reminders stop, the task stays open
select pg_temp.eq(
  (select affected from public.reminder_act('aaaaaaaa-0000-4000-8000-000000000001', 'task', '11111111-0000-4000-8000-000000000006', 'stop')),
  1, 'stop');
select pg_temp.eq((select status from public.tasks where id = '11111111-0000-4000-8000-000000000006'), 'open', 'stopping keeps the task open');
select pg_temp.eq(
  (select count(*)::int from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000006'),
  0, 'stopped item off the list');

-- ---------------------------------------------------------------------------
-- 6. Daily until done + overlap with the day-of reminder -> one item.
-- ---------------------------------------------------------------------------
select pg_temp.as_service();
set reminders.now = '2026-10-04 12:00:00+00';
insert into public.tasks (id, user_id, title, due_date, description)
values ('11111111-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000001', 'Order Mom''s gift', '2026-10-11', 'Birthday Wed 10/14; order at least 3 days before');
insert into public.reminders (user_id, task_id, kind, local_time, title, timezone, note)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000007', 'daily', '09:00', 'Order Mom''s gift', 'America/New_York',
        'Birthday is Wed 10/14 -- order by Sun 10/11 (3 days before)');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000007' and kind = 'daily'),
  '2026-10-04 09:00:00 America/New_York'::timestamptz, 'daily: at 08:00 local the next is today 09:00');
select pg_temp.eq(
  (select status_reason from public.reminders where task_id = '11111111-0000-4000-8000-000000000007' and origin = 'default'),
  'replaced', 'daily replaces the automatic reminder');
select pg_temp.eq(
  (select count(*)::int from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000007'),
  1, 'one item per task, however many rules');
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000007'),
  'daily', 'daily item is on today''s list');
-- keeps going daily while unanswered (no auto-stop)
select pg_temp.eq(
  public.reminders_mark_fired((select id from public.reminders where task_id = '11111111-0000-4000-8000-000000000007' and kind = 'daily'), '2026-10-04 09:00:00 America/New_York'),
  '2026-10-05 09:00:00 America/New_York'::timestamptz, 'daily continues next day');
-- completing ends the daily nudging
update public.tasks set status = 'completed', completed_at = now() where id = '11111111-0000-4000-8000-000000000007';
select pg_temp.eq(
  (select count(*)::int from public.reminders where task_id = '11111111-0000-4000-8000-000000000007' and status = 'active'),
  0, 'completing a daily-nudged task ends it');

-- ---------------------------------------------------------------------------
-- 7. Repeating task (monthly on the 31st) vs daily nudging.
-- ---------------------------------------------------------------------------
select pg_temp.eq(public.task_next_occurrence('2026-01-31', 'month', 1, '2026-01-31'), '2026-02-28'::date, 'monthly 31st -> Feb 28');
select pg_temp.eq(public.task_next_occurrence('2026-01-31', 'month', 1, '2026-02-28'), '2026-03-31'::date, 'then back to Mar 31 (no drift)');
select pg_temp.eq(public.task_next_occurrence('2028-01-31', 'month', 1, '2028-01-31'), '2028-02-29'::date, 'leap year Feb 29');
select pg_temp.eq(public.task_next_occurrence('2026-10-05', 'week', 2, '2026-10-05'), '2026-10-19'::date, 'every 2 weeks');
select pg_temp.eq(public.task_next_occurrence('2026-10-05', 'day', 1, '2026-10-20'), '2026-10-21'::date, 'daily, far behind -> next after the given day');

insert into public.tasks (id, user_id, title, due_date, recur_freq, recur_interval, recur_anchor)
values ('11111111-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000001', 'Check the filter', '2026-10-31', 'month', 1, '2026-10-31');
update public.tasks set status = 'completed', completed_at = now() where id = '11111111-0000-4000-8000-000000000008';
select pg_temp.eq(
  (select status || ' ' || due_date from public.tasks where id = '11111111-0000-4000-8000-000000000008'),
  'open 2026-11-30', 'completing this occurrence moves to the next one');
select pg_temp.eq(
  (select count(*)::int from public.task_completions where task_id = '11111111-0000-4000-8000-000000000008'),
  1, 'occurrence logged');
select pg_temp.eq(
  (select status from public.reminders where task_id = '11111111-0000-4000-8000-000000000008' and origin = 'default'),
  'active', 'repeating task keeps its reminder');
-- stopping the repetition then completing closes it
update public.tasks set recur_freq = null where id = '11111111-0000-4000-8000-000000000008';
update public.tasks set status = 'completed', completed_at = now() where id = '11111111-0000-4000-8000-000000000008';
select pg_temp.eq((select status from public.tasks where id = '11111111-0000-4000-8000-000000000008'), 'completed', 'repeat stopped -> completion closes');

-- ---------------------------------------------------------------------------
-- 8. Reminder on a record (no task created); acknowledge keeps the record.
-- ---------------------------------------------------------------------------
insert into public.sessions (id, user_id, mode, title) values
  ('22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'capture', 'Pricing idea');
insert into public.reminders (user_id, session_id, kind, fire_at, title, timezone)
values ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'once', '2026-11-02 09:00:00 America/New_York', 'Pricing idea', 'America/New_York');
select pg_temp.eq(
  (select bucket || '/' || reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '22222222-0000-4000-8000-000000000001'),
  'later/upcoming', 'record reminder listed as later');
select pg_temp.eq((select count(*)::int from public.tasks where source_session_id = '22222222-0000-4000-8000-000000000001'), 0, 'no task created for a record reminder');
set reminders.now = '2026-11-02 15:00:00+00';
select pg_temp.eq(
  public.reminders_mark_fired((select id from public.reminders where session_id = '22222222-0000-4000-8000-000000000001'), '2026-11-02 09:00:00 America/New_York'),
  null::timestamptz, 'once: nothing after it fired');
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '22222222-0000-4000-8000-000000000001'),
  'scheduled_today', 'fired today -> still today until acknowledged');
set reminders.now = '2026-11-04 15:00:00+00';
select pg_temp.eq(
  (select reason from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '22222222-0000-4000-8000-000000000001'),
  'pending', 'reading/firing never completes it: still pending days later');
select pg_temp.eq(
  (select affected from public.reminder_act('aaaaaaaa-0000-4000-8000-000000000001', 'session', '22222222-0000-4000-8000-000000000001', 'acknowledge')),
  1, 'acknowledge');
select pg_temp.eq((select count(*)::int from public.sessions where id = '22222222-0000-4000-8000-000000000001'), 1, 'record kept after acknowledge');

-- ---------------------------------------------------------------------------
-- 9. Context ("at home") items.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, user_id, title) values ('11111111-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001', 'Email the quote from home');
insert into public.reminders (user_id, task_id, kind, context_tag, title, timezone)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000009', 'context', 'home', 'Email the quote from home', 'America/New_York');
select pg_temp.eq(
  (select bucket || '/' || context_tag from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001') where target_id = '11111111-0000-4000-8000-000000000009'),
  'context/home', 'context item in its own bucket');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-000000000009'),
  null::timestamptz, 'context item never pushes');

-- ---------------------------------------------------------------------------
-- 10. Time zone / settings change recompute only what's unsent.
-- ---------------------------------------------------------------------------
set reminders.now = '2026-10-10 12:00:00+00';
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000002', 'Seoul task', '2026-10-20');
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-00000000000a'),
  '2026-10-19 09:00:00 Asia/Seoul'::timestamptz, 'Seoul 09:00');
update public.profiles set timezone = 'Europe/London' where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-00000000000a'),
  '2026-10-19 09:00:00 Europe/London'::timestamptz, 'moving zones keeps the date, 09:00 in the new zone');
update public.profiles set reminder_time = '08:30', remind_day_before = false where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-00000000000a'),
  '2026-10-20 08:30:00 Europe/London'::timestamptz, 'settings change: day-of only, 08:30');
-- an automatic time inside quiet hours (22:00-08:00) waits for the end of them
update public.profiles set reminder_time = '07:30' where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select pg_temp.eq(
  (select next_fire_at from public.reminders where task_id = '11111111-0000-4000-8000-00000000000a'),
  '2026-10-20 08:00:00 Europe/London'::timestamptz, 'automatic reminder never lands in quiet hours');

-- ---------------------------------------------------------------------------
-- 11. Deliveries: one per device per target per moment; stale slots flagged.
-- ---------------------------------------------------------------------------
insert into public.reminder_deliveries (user_id, target_key, slot_at, installation_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'task:x', '2026-10-01 13:00:00+00', 'install-1');
do $$
begin
  begin
    insert into public.reminder_deliveries (user_id, target_key, slot_at, installation_id)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'task:x', '2026-10-01 13:00:00+00', 'install-1');
    raise exception 'FAIL duplicate delivery was accepted';
  exception when unique_violation then
    raise notice 'ok  duplicate delivery (same device, target, moment) rejected';
  end;
end $$;

set reminders.now = '2026-10-01 13:00:00+00';
insert into public.tasks (id, user_id, title, due_date)
values ('11111111-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001', 'Outage', '2026-10-03');
-- dispatcher was down for a day
set reminders.now = '2026-10-02 20:00:00+00';
select pg_temp.eq(
  (select stale from public.reminders_claim_due(100, 120) where target_id = '11111111-0000-4000-8000-00000000000b'),
  true, 'a slot more than 6h late is flagged stale (not pushed)');
-- mark_fired after the schedule changed meanwhile only releases the lease
update public.tasks set due_date = '2026-10-10' where id = '11111111-0000-4000-8000-00000000000b';
select pg_temp.eq(
  public.reminders_mark_fired((select id from public.reminders where task_id = '11111111-0000-4000-8000-00000000000b'), '2026-10-02 09:00:00 America/New_York'),
  null::timestamptz, 'stale mark_fired is a no-op');
select pg_temp.eq(
  (select next_fire_at || '|' || coalesce(lease_until::text, 'none') from public.reminders where task_id = '11111111-0000-4000-8000-00000000000b'),
  '2026-10-09 09:00:00 America/New_York'::timestamptz || '|none', 'rescheduled slot kept, lease released');

-- ---------------------------------------------------------------------------
-- 12. Ownership / RLS.
-- ---------------------------------------------------------------------------
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set role authenticated;
do $$
begin
  begin
    insert into public.reminders (user_id, task_id, kind, fire_at, title, timezone)
    values ('bbbbbbbb-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', 'once', now() + interval '1 day', 'x', 'UTC');
    raise exception 'FAIL reminder on someone else''s task was accepted';
  exception when insufficient_privilege or check_violation then
    raise notice 'ok  cannot attach a reminder to another user''s task';
  end;
  begin
    perform * from public.reminder_agenda('aaaaaaaa-0000-4000-8000-000000000001');
    raise exception 'FAIL read another user''s agenda';
  exception when insufficient_privilege then
    raise notice 'ok  cannot read another user''s agenda';
  end;
  begin
    perform * from public.reminder_act('bbbbbbbb-0000-4000-8000-000000000002', 'task', '11111111-0000-4000-8000-000000000001', 'stop');
    raise exception 'FAIL act on another user''s task';
  exception when no_data_found then
    raise notice 'ok  cannot act on another user''s task';
  end;
  begin
    perform * from public.reminders_claim_due(10, 60);
    raise exception 'FAIL user called the dispatcher claim';
  exception when insufficient_privilege then
    raise notice 'ok  dispatcher functions are server-only';
  end;
end $$;
select pg_temp.eq((select count(*)::int from public.reminders), 1, 'B sees only B''s reminders');

-- Installation moves with the signed-in account.
select public.register_push_installation('install-abc-123', 'ExponentPushToken[b]', 'android', 'granted');
reset role;
select pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
set role authenticated;
select public.register_push_installation('install-abc-123', 'ExponentPushToken[a]', 'android', 'granted');
reset role;
select pg_temp.eq(
  (select user_id::text || ' ' || expo_push_token from public.push_installations where installation_id = 'install-abc-123'),
  'aaaaaaaa-0000-4000-8000-000000000001 ExponentPushToken[a]', 'install now belongs to the new account only');
select pg_temp.eq((select count(*)::int from public.push_installations), 1, 'no leftover row for the previous account');
select pg_temp.as_user('bbbbbbbb-0000-4000-8000-000000000002');
set role authenticated;
select public.unregister_push_installation('install-abc-123');
reset role;
select pg_temp.eq((select count(*)::int from public.push_installations), 1, 'another account cannot unregister it');

\echo ALL REMINDER TESTS PASSED
