-- Reminders: "say it once, get reminded when it matters".
--
-- Concepts (see docs/REMINDERS.md):
--   * a record (session) / idea (memory) / task is the TARGET -- never
--     duplicated or deleted because of a reminder;
--   * a REMINDER is one rule saying when to bring a target back up:
--       due     -- relative to the task's due date (day offsets + a local time;
--                  the automatic "day before + day of at 9:00" is one of these
--                  with origin = 'default')
--       daily   -- every day at a local time until the target is done
--                  ("keep reminding me until it's done")
--       once    -- one absolute moment ("in two hours", "next month",
--                  "check Thursday whether David replied")
--       context -- no time; shown when the user asks for that context
--                  ("things to do at home")
--   * a DELIVERY is one push of one slot to one app installation.
--
-- Every "when does this fire next" answer comes from reminder_next_fire()
-- below, kept in reminders.next_fire_at by a trigger, so the app, the
-- dispatcher and the voice tools all agree. Local dates and times are turned
-- into instants with `(date + time) AT TIME ZONE tz`, so "the day before"
-- is a calendar day in the user's zone and DST days are 23/25 hours long
-- without special cases.
--
-- Tests: supabase/tests/reminders_test.sql (run against a local Postgres).

-- ---------------------------------------------------------------------------
-- Clock (overridable in tests with: set reminders.now = '...')
-- ---------------------------------------------------------------------------
create or replace function public.reminder_now()
returns timestamptz
language sql
stable
as $$
  select coalesce(nullif(current_setting('reminders.now', true), '')::timestamptz, now())
$$;

-- ---------------------------------------------------------------------------
-- Settings on the profile
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists reminder_time time not null default '09:00',
  add column if not exists remind_day_before boolean not null default true,
  add column if not exists remind_day_of boolean not null default true,
  -- null quiet_start/quiet_end = no quiet hours
  add column if not exists quiet_start time default '22:00',
  add column if not exists quiet_end time default '08:00',
  -- false: pushes say only "You have a reminder" on the lock screen
  add column if not exists reminder_preview boolean not null default true;

-- ---------------------------------------------------------------------------
-- Repeating tasks ("check the filter every month"): the task's due_date is
-- the current (earliest unfinished) occurrence; completing it logs the
-- occurrence and moves due_date to the next one, counted from the anchor so
-- a 31st stays the 31st (or the month's last day) and never drifts to the
-- day it happened to be completed.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists recur_freq text check (recur_freq in ('day', 'week', 'month')),
  add column if not exists recur_interval integer check (recur_interval between 1 and 365),
  add column if not exists recur_anchor date;

create table if not exists public.task_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  occurrence_date date,
  completed_at timestamptz not null default now()
);
create index if not exists task_completions_task_idx on public.task_completions (task_id, completed_at desc);
alter table public.task_completions enable row level security;
create policy "Users can view their own task completions"
  on public.task_completions for select
  using (auth.uid() = user_id);

create or replace function public.task_next_occurrence(p_anchor date, p_freq text, p_interval integer, p_after date)
returns date
language plpgsql
immutable
as $$
declare
  v_step integer;
  v_k integer;
  v_d date;
begin
  if p_anchor is null or p_freq is null then
    return null;
  end if;
  if p_after < p_anchor then
    return p_anchor;
  end if;
  if p_freq in ('day', 'week') then
    v_step := coalesce(p_interval, 1) * case when p_freq = 'week' then 7 else 1 end;
    return p_anchor + (((p_after - p_anchor) / v_step) + 1) * v_step;
  end if;
  -- month: anchor + k*interval months (Postgres clamps to the month's last day)
  v_k := greatest(
    0,
    (((extract(year from p_after) - extract(year from p_anchor)) * 12
      + (extract(month from p_after) - extract(month from p_anchor)))::integer / coalesce(p_interval, 1)) - 1
  );
  loop
    v_d := (p_anchor + make_interval(months => v_k * coalesce(p_interval, 1)))::date;
    exit when v_d > p_after;
    v_k := v_k + 1;
  end loop;
  return v_d;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push installations: one row per app install, owned by whoever is signed in
-- on it right now (signing in as someone else moves it; signing out deletes
-- it), so a push never reaches a device for a different account.
-- ---------------------------------------------------------------------------
create table if not exists public.push_installations (
  id uuid primary key default gen_random_uuid(),
  installation_id text not null unique check (char_length(installation_id) between 8 and 100),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text,
  platform text check (platform in ('ios', 'android')),
  permission text not null default 'undetermined' check (permission in ('granted', 'denied', 'undetermined')),
  enabled boolean not null default false,
  last_error text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_installations_user_idx on public.push_installations (user_id) where enabled;
create trigger set_push_installations_updated_at
  before update on public.push_installations
  for each row execute function public.set_updated_at();
alter table public.push_installations enable row level security;
create policy "Users can view their own installations"
  on public.push_installations for select
  using (auth.uid() = user_id);
-- Writes go through register/unregister below (they move an install between
-- accounts, which a plain RLS insert/update can't express safely).

create or replace function public.register_push_installation(
  p_installation_id text,
  p_token text,
  p_platform text,
  p_permission text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- One token belongs to one install: a reinstall gets a new installation id
  -- but can get the same token back -- drop the stale row.
  if p_token is not null then
    delete from push_installations where expo_push_token = p_token and installation_id <> p_installation_id;
  end if;
  insert into push_installations (installation_id, user_id, expo_push_token, platform, permission, enabled, last_seen_at, last_error)
  values (
    p_installation_id, v_user, p_token, p_platform, coalesce(p_permission, 'undetermined'),
    p_token is not null and p_permission = 'granted', now(), null
  )
  on conflict (installation_id) do update
    set user_id = excluded.user_id,
        expo_push_token = excluded.expo_push_token,
        platform = excluded.platform,
        permission = excluded.permission,
        enabled = excluded.enabled,
        last_seen_at = now(),
        last_error = null;
end;
$$;

create or replace function public.unregister_push_installation(p_installation_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_installations where installation_id = p_installation_id and user_id = auth.uid();
$$;

revoke all on function public.register_push_installation(text, text, text, text) from public, anon;
revoke all on function public.unregister_push_installation(text) from public, anon;
grant execute on function public.register_push_installation(text, text, text, text) to authenticated;
grant execute on function public.unregister_push_installation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete cascade,
  memory_id uuid references public.memories (id) on delete cascade,
  kind text not null check (kind in ('due', 'daily', 'once', 'context')),
  -- 'waiting' = "check whether they replied" -- the app never claims to know
  purpose text not null default 'remind' check (purpose in ('remind', 'waiting')),
  -- 'default' = the automatic day-before/day-of reminder of a dated task
  origin text not null default 'user' check (origin in ('default', 'user')),
  -- Snapshot for records/ideas (a task's live title is used instead).
  title text not null check (char_length(title) between 1 and 300),
  -- Why it matters ("order 3 days before Mom's birthday on Wed 10/7").
  note text check (char_length(note) <= 1000),
  source_session_id uuid references public.sessions (id) on delete set null,
  source_quote text check (char_length(source_quote) <= 1000),
  timezone text not null default 'UTC',
  local_time time,
  day_offsets integer[] check (day_offsets is null or cardinality(day_offsets) between 1 and 8),
  fire_at timestamptz,
  start_date date,
  ends_on date,
  context_tag text check (char_length(context_tag) <= 40),
  status text not null default 'active' check (status in ('active', 'stopped', 'done')),
  -- why it stopped/finished: user_stopped | acknowledged | target_done | no_due_date | replaced
  status_reason text,
  snoozed_until timestamptz,
  suppressed_until timestamptz,
  last_fired_at timestamptz,
  next_fire_at timestamptz,
  lease_until timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(task_id, session_id, memory_id) = 1),
  check (kind <> 'due' or task_id is not null),
  check (kind <> 'once' or fire_at is not null),
  check (kind <> 'context' or context_tag is not null),
  check (origin <> 'default' or kind = 'due')
);

create index if not exists reminders_due_idx on public.reminders (next_fire_at) where status = 'active' and next_fire_at is not null;
create index if not exists reminders_user_idx on public.reminders (user_id, status);
create index if not exists reminders_task_idx on public.reminders (task_id) where task_id is not null;
create index if not exists reminders_session_idx on public.reminders (session_id) where session_id is not null;
create index if not exists reminders_memory_idx on public.reminders (memory_id) where memory_id is not null;
-- One automatic due reminder per task.
create unique index if not exists reminders_default_per_task on public.reminders (task_id) where origin = 'default';

alter table public.reminders enable row level security;
create policy "Users can view their own reminders"
  on public.reminders for select
  using (auth.uid() = user_id);
create policy "Users can delete their own reminders"
  on public.reminders for delete
  using (auth.uid() = user_id);
-- The target must be the user's own, whichever kind it is.
create policy "Users can insert their own reminders"
  on public.reminders for insert
  with check (
    auth.uid() = user_id
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()))
    and (session_id is null or exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()))
    and (memory_id is null or exists (select 1 from public.memories m where m.id = memory_id and m.user_id = auth.uid()))
    and (source_session_id is null or exists (select 1 from public.sessions s where s.id = source_session_id and s.user_id = auth.uid()))
  );
create policy "Users can update their own reminders"
  on public.reminders for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (task_id is null or exists (select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()))
    and (session_id is null or exists (select 1 from public.sessions s where s.id = session_id and s.user_id = auth.uid()))
    and (memory_id is null or exists (select 1 from public.memories m where m.id = memory_id and m.user_id = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Time helpers
-- ---------------------------------------------------------------------------
/** The instant a local date + wall-clock time happens in a zone. */
create or replace function public.reminder_local_ts(p_date date, p_time time, p_tz text)
returns timestamptz
language sql
stable
as $$
  select (p_date + p_time) at time zone coalesce(nullif(p_tz, ''), 'UTC')
$$;

create or replace function public.reminder_in_quiet(p_at timestamptz, p_tz text, p_start time, p_end time)
returns boolean
language plpgsql
stable
as $$
declare
  v_t time;
begin
  if p_start is null or p_end is null or p_start = p_end then
    return false;
  end if;
  v_t := (p_at at time zone coalesce(nullif(p_tz, ''), 'UTC'))::time;
  if p_start < p_end then
    return v_t >= p_start and v_t < p_end;
  end if;
  return v_t >= p_start or v_t < p_end; -- wraps midnight (22:00-08:00)
end;
$$;

/** p_at, or -- if it falls in quiet hours -- the end of those quiet hours. */
create or replace function public.reminder_after_quiet(p_at timestamptz, p_tz text, p_start time, p_end time)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_day date;
  v_end timestamptz;
begin
  if not public.reminder_in_quiet(p_at, v_tz, p_start, p_end) then
    return p_at;
  end if;
  v_day := (p_at at time zone v_tz)::date;
  v_end := public.reminder_local_ts(v_day, p_end, v_tz);
  if v_end <= p_at then
    v_end := public.reminder_local_ts(v_day + 1, p_end, v_tz);
  end if;
  return v_end;
end;
$$;

-- ---------------------------------------------------------------------------
-- The one place that decides when a reminder fires next (strictly after p_after).
-- ---------------------------------------------------------------------------
create or replace function public.reminder_next_fire(r public.reminders, p_after timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  t public.tasks%rowtype;
  v_after timestamptz;
  v_time time;
  v_offsets integer[];
  v_off integer;
  v_candidate timestamptz;
  v_day date;
  i integer;
begin
  if r.status <> 'active' then
    return null;
  end if;
  if r.task_id is not null then
    select * into t from public.tasks where id = r.task_id;
    if not found or t.status <> 'open' then
      return null;
    end if;
  end if;
  select * into p from public.profiles where id = r.user_id;

  -- A snooze replaces whatever would have come before it.
  if r.snoozed_until is not null and r.snoozed_until > p_after then
    return r.snoozed_until;
  end if;
  -- "Not today": nothing before the end of the suppressed day.
  v_after := greatest(p_after, coalesce(r.suppressed_until, p_after));
  v_time := coalesce(r.local_time, p.reminder_time, time '09:00');

  if r.kind = 'due' then
    if t.due_date is null then
      return null;
    end if;
    v_offsets := coalesce(
      r.day_offsets,
      array_remove(array[
        case when coalesce(p.remind_day_before, true) then -1 end,
        case when coalesce(p.remind_day_of, true) then 0 end
      ], null)
    );
    for v_off in select x from unnest(v_offsets) x order by x loop
      v_candidate := public.reminder_local_ts(t.due_date + v_off, v_time, r.timezone);
      -- Automatic reminders stay out of quiet hours; a time the user asked
      -- for is kept as asked (the app/voice says so when they collide).
      if r.origin = 'default' then
        v_candidate := public.reminder_after_quiet(v_candidate, r.timezone, p.quiet_start, p.quiet_end);
      end if;
      if v_candidate > v_after then
        return v_candidate;
      end if;
    end loop;
    return null;
  elsif r.kind = 'daily' then
    v_day := greatest(coalesce(r.start_date, (v_after at time zone r.timezone)::date), (v_after at time zone r.timezone)::date);
    for i in 0..2 loop
      if r.ends_on is not null and v_day + i > r.ends_on then
        return null;
      end if;
      v_candidate := public.reminder_local_ts(v_day + i, v_time, r.timezone);
      if v_candidate > v_after then
        return v_candidate;
      end if;
    end loop;
    return null;
  elsif r.kind = 'once' then
    if r.fire_at > v_after then
      return r.fire_at;
    end if;
    return null;
  end if;
  return null; -- context: no time
end;
$$;

create or replace function public.reminders_before_write()
returns trigger
language plpgsql
as $$
declare
  v_schedule_changed boolean := tg_op = 'INSERT';
  v_floor timestamptz;
begin
  if tg_op = 'UPDATE' then
    -- The dispatcher taking/releasing its lease is bookkeeping, not a
    -- change: the slot it is about to send must stay put.
    if new.lease_until is distinct from old.lease_until
       and (to_jsonb(new) - 'lease_until' - 'updated_at') = (to_jsonb(old) - 'lease_until' - 'updated_at') then
      return new;
    end if;
    v_schedule_changed := (
      new.kind, new.local_time, new.day_offsets, new.fire_at, new.start_date, new.ends_on,
      new.timezone, new.status, new.snoozed_until, new.suppressed_until
    ) is distinct from (
      old.kind, old.local_time, old.day_offsets, old.fire_at, old.start_date, old.ends_on,
      old.timezone, old.status, old.snoozed_until, old.suppressed_until
    );
    if v_schedule_changed then
      new.version := old.version + 1;
    end if;
  end if;
  if new.status <> 'active' then
    new.snoozed_until := null;
    new.suppressed_until := null;
  end if;
  -- Never earlier than the last slot already sent, and never in the past
  -- for a new or changed schedule (no burst of old alerts). A plain
  -- recompute (task renamed/re-dated, settings touched) keeps a slot that
  -- came due in the last 10 minutes but hasn't been dispatched yet.
  v_floor := case when v_schedule_changed then public.reminder_now() else public.reminder_now() - interval '10 minutes' end;
  new.next_fire_at := public.reminder_next_fire(
    new,
    greatest(v_floor, coalesce(new.last_fired_at, '-infinity'::timestamptz))
  );
  return new;
end;
$$;

drop trigger if exists reminders_before_write on public.reminders;
create trigger reminders_before_write
  before insert or update on public.reminders
  for each row execute function public.reminders_before_write();

create trigger set_reminders_updated_at
  before update on public.reminders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tasks drive their reminders
-- ---------------------------------------------------------------------------
-- Completing an occurrence of a repeating task: log it and move to the next
-- occurrence instead of closing the task.
create or replace function public.tasks_before_complete_recurring()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recur_freq is not null and new.recur_anchor is null then
    new.recur_anchor := coalesce(new.due_date, (public.reminder_now())::date);
  end if;
  if new.recur_freq is not null and new.due_date is null then
    new.due_date := new.recur_anchor;
  end if;
  if tg_op = 'UPDATE'
     and old.status = 'open' and new.status = 'completed'
     and new.recur_freq is not null then
    insert into public.task_completions (user_id, task_id, occurrence_date, completed_at)
    values (new.user_id, new.id, old.due_date, coalesce(new.completed_at, now()));
    new.status := 'open';
    new.completed_at := null;
    new.due_date := public.task_next_occurrence(new.recur_anchor, new.recur_freq, coalesce(new.recur_interval, 1), coalesce(old.due_date, new.recur_anchor));
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_before_complete_recurring on public.tasks;
create trigger tasks_before_complete_recurring
  before insert or update on public.tasks
  for each row execute function public.tasks_before_complete_recurring();

create or replace function public.tasks_sync_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  if new.status <> 'open' then
    -- Done/cancelled: every live reminder of it is finished.
    update public.reminders
       set status = 'done', status_reason = 'target_done'
     where task_id = new.id and status = 'active';
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'open' then
    -- Reopened: bring back what completion ended -- future slots only (the
    -- trigger never recomputes before now), so nothing old is re-sent.
    update public.reminders
       set status = 'active', status_reason = null
     where task_id = new.id and status = 'done' and status_reason = 'target_done';
  end if;

  if new.due_date is null then
    -- No date: date-relative reminders stop; separately set ones stay.
    update public.reminders
       set status = 'stopped', status_reason = 'no_due_date'
     where task_id = new.id and kind = 'due' and status = 'active';
  else
    select coalesce(nullif(timezone, ''), 'UTC') into v_tz from public.profiles where id = new.user_id;
    -- Bring back due reminders that only stopped for lack of a date.
    update public.reminders
       set status = 'active', status_reason = null
     where task_id = new.id and kind = 'due' and status = 'stopped' and status_reason = 'no_due_date';
    -- The automatic day-before/day-of reminder, unless the user set their
    -- own time-based reminder for this task (theirs wins).
    if not exists (
      select 1 from public.reminders
       where task_id = new.id and origin = 'user' and kind in ('due', 'daily', 'once') and status = 'active'
    ) then
      insert into public.reminders (user_id, task_id, kind, origin, title, timezone)
      values (new.user_id, new.id, 'due', 'default', left(new.title, 300), coalesce(v_tz, 'UTC'))
      on conflict (task_id) where origin = 'default' do nothing;
    end if;
  end if;

  -- Recompute everything still live (a new date, a new title).
  update public.reminders
     set title = left(new.title, 300)
   where task_id = new.id and status = 'active';
  return new;
end;
$$;

drop trigger if exists tasks_sync_reminders on public.tasks;
create trigger tasks_sync_reminders
  after insert or update of due_date, status, title on public.tasks
  for each row execute function public.tasks_sync_reminders();

-- A user-set time-based reminder on a task replaces the automatic one.
create or replace function public.reminders_replace_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_id is not null and new.origin = 'user' and new.kind in ('due', 'daily', 'once') and new.status = 'active' then
    update public.reminders
       set status = 'stopped', status_reason = 'replaced'
     where task_id = new.task_id and origin = 'default' and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists reminders_replace_default on public.reminders;
create trigger reminders_replace_default
  after insert on public.reminders
  for each row execute function public.reminders_replace_default();

-- Settings/time zone changes recompute what hasn't been sent yet.
create or replace function public.profiles_sync_reminders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.timezone is distinct from old.timezone) then
    update public.reminders
       set timezone = new.timezone
     where user_id = new.id and status = 'active' and kind in ('due', 'daily');
  end if;
  if (new.reminder_time, new.remind_day_before, new.remind_day_of, new.quiet_start, new.quiet_end)
     is distinct from (old.reminder_time, old.remind_day_before, old.remind_day_of, old.quiet_start, old.quiet_end) then
    update public.reminders
       set updated_at = now()
     where user_id = new.id and status = 'active' and kind in ('due', 'daily');
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_reminders on public.profiles;
create trigger profiles_sync_reminders
  after update of timezone, reminder_time, remind_day_before, remind_day_of, quiet_start, quiet_end on public.profiles
  for each row execute function public.profiles_sync_reminders();

-- ---------------------------------------------------------------------------
-- "What to keep in mind today": one row per TARGET (a task's day-before,
-- day-of and daily rules are one item). Home's count, the list and the
-- spoken briefing all read this.
-- ---------------------------------------------------------------------------
create or replace function public.reminder_agenda(p_user uuid, p_now timestamptz default null)
returns table (
  target_type text,
  target_id uuid,
  title text,
  note text,
  due_date date,
  bucket text,          -- now | later | context
  reason text,          -- overdue | due_today | daily | scheduled_today | pending | snoozed | not_today | upcoming | context
  next_fire_at timestamptz,
  snoozed_until timestamptz,
  suppressed_until timestamptz,
  context_tag text,
  purpose text,
  source_session_id uuid,
  is_recurring boolean,
  reminder_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, public.reminder_now());
  v_tz text;
  v_today date;
begin
  if not (auth.role() = 'service_role' or auth.uid() = p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(nullif(pr.timezone, ''), 'UTC') into v_tz from public.profiles pr where pr.id = p_user;
  v_tz := coalesce(v_tz, 'UTC');
  v_today := (v_now at time zone v_tz)::date;

  return query
  with live as (
    select r.*,
           case when r.task_id is not null then 'task' when r.session_id is not null then 'session' else 'memory' end as ttype,
           coalesce(r.task_id, r.session_id, r.memory_id) as tid
      from public.reminders r
      left join public.tasks tk on tk.id = r.task_id
     where r.user_id = p_user
       and r.status = 'active'
       and (r.task_id is null or tk.status = 'open')
  ),
  g as (
    select l.ttype, l.tid,
           array_agg(l.id order by l.created_at) as ids,
           max(l.snoozed_until) filter (where l.snoozed_until > v_now) as snz,
           max(l.suppressed_until) filter (where l.suppressed_until > v_now) as sup,
           min(l.next_fire_at) as nxt,
           bool_or(l.kind = 'daily'
                   and coalesce(l.start_date, v_today) <= v_today
                   and (l.ends_on is null or l.ends_on >= v_today)) as daily_today,
           bool_and(l.kind = 'context') as only_ctx,
           max(l.context_tag) as ctx,
           bool_or(l.last_fired_at is not null) as ever_fired,
           bool_or(l.last_fired_at is not null and (l.last_fired_at at time zone v_tz)::date = v_today) as fired_today,
           (array_agg(l.note order by l.created_at desc) filter (where l.note is not null))[1] as note,
           case when bool_or(l.purpose = 'waiting') then 'waiting' else 'remind' end as purpose,
           (array_agg(l.source_session_id order by l.created_at desc) filter (where l.source_session_id is not null))[1] as src,
           (array_agg(l.title order by l.created_at desc))[1] as snap_title
      from live l
     group by l.ttype, l.tid
  ),
  items as (
    select g.*,
           t.title as task_title, t.due_date as t_due, t.recur_freq, t.source_session_id as t_src, t.description as t_desc,
           s.title as s_title, s.summary as s_summary,
           m.content as m_content, m.source_session_id as m_src
      from g
      left join public.tasks t on g.ttype = 'task' and t.id = g.tid
      left join public.sessions s on g.ttype = 'session' and s.id = g.tid
      left join public.memories m on g.ttype = 'memory' and m.id = g.tid
  ),
  classified as (
    select i.*,
           case
             when i.only_ctx then 'context'
             when i.snz is not null then 'later'
             when i.sup is not null then 'later'
             when i.ttype = 'task' and i.t_due < v_today then 'now'
             when i.ttype = 'task' and i.t_due = v_today then 'now'
             when i.daily_today then 'now'
             when i.nxt is not null and (i.nxt at time zone v_tz)::date = v_today then 'now'
             when i.fired_today then 'now'
             when i.nxt is null and i.ever_fired then 'now'
             when i.nxt is not null then 'later'
             else null
           end as bkt,
           case
             when i.only_ctx then 'context'
             when i.snz is not null then 'snoozed'
             when i.sup is not null then 'not_today'
             when i.ttype = 'task' and i.t_due < v_today then 'overdue'
             when i.ttype = 'task' and i.t_due = v_today then 'due_today'
             when i.daily_today then 'daily'
             when i.nxt is not null and (i.nxt at time zone v_tz)::date = v_today then 'scheduled_today'
             when i.fired_today then 'scheduled_today'
             when i.nxt is null and i.ever_fired then 'pending'
             when i.nxt is not null then 'upcoming'
           end as rsn
      from items i
  )
  select c.ttype,
         c.tid,
         coalesce(c.task_title, c.s_title, left(c.m_content, 160), c.snap_title),
         coalesce(c.note, c.t_desc),
         c.t_due,
         c.bkt,
         c.rsn,
         c.nxt,
         c.snz,
         c.sup,
         c.ctx,
         c.purpose,
         coalesce(c.src, c.t_src, c.m_src, case when c.ttype = 'session' then c.tid end),
         c.recur_freq is not null,
         c.ids
    from classified c
   where c.bkt is not null
   order by
     case c.bkt when 'now' then 0 when 'later' then 1 else 2 end,
     case c.rsn when 'overdue' then 0 when 'due_today' then 1 when 'daily' then 2 when 'scheduled_today' then 3 when 'pending' then 4 else 5 end,
     coalesce(c.snz, c.sup, c.nxt, c.t_due::timestamptz),
     c.t_due nulls last,
     c.tid;
end;
$$;

revoke all on function public.reminder_agenda(uuid, timestamptz) from public, anon;
grant execute on function public.reminder_agenda(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Acting on a target's reminders (app buttons and voice): snooze, not today,
-- stop, acknowledge, resume. Returns the next time it will come up.
-- ---------------------------------------------------------------------------
create or replace function public.reminder_act(
  p_user uuid,
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_until timestamptz default null
)
returns table (next_fire_at timestamptz, effective_until timestamptz, affected integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.reminder_now();
  v_tz text;
  v_qs time;
  v_qe time;
  v_until timestamptz;
  v_title text;
  v_count integer := 0;
begin
  if not (auth.role() = 'service_role' or auth.uid() = p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_target_type not in ('task', 'session', 'memory') then
    raise exception 'unknown target type' using errcode = '22023';
  end if;
  -- The target must be this user's.
  if p_target_type = 'task' then
    select t.title into v_title from public.tasks t where t.id = p_target_id and t.user_id = p_user;
  elsif p_target_type = 'session' then
    select coalesce(s.title, 'Recording') into v_title from public.sessions s where s.id = p_target_id and s.user_id = p_user;
  else
    select left(m.content, 300) into v_title from public.memories m where m.id = p_target_id and m.user_id = p_user;
  end if;
  if v_title is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;

  select coalesce(nullif(pr.timezone, ''), 'UTC'), pr.quiet_start, pr.quiet_end
    into v_tz, v_qs, v_qe
    from public.profiles pr where pr.id = p_user;
  v_tz := coalesce(v_tz, 'UTC');

  if p_action = 'snooze' then
    if p_until is null or p_until <= v_now then
      raise exception 'snooze time must be in the future' using errcode = '22023';
    end if;
    -- "Later" never lands in quiet hours; the caller tells the user the real time.
    v_until := public.reminder_after_quiet(p_until, v_tz, v_qs, v_qe);
    update public.reminders r
       set snoozed_until = v_until, suppressed_until = null
     where r.user_id = p_user and r.status = 'active'
       and ((p_target_type = 'task' and r.task_id = p_target_id)
         or (p_target_type = 'session' and r.session_id = p_target_id)
         or (p_target_type = 'memory' and r.memory_id = p_target_id))
       and r.kind <> 'context';
    get diagnostics v_count = row_count;
    if v_count = 0 then
      -- Nothing scheduled yet ("remind me about this in two hours"): one reminder at that time.
      insert into public.reminders (user_id, task_id, session_id, memory_id, kind, fire_at, title, timezone)
      values (
        p_user,
        case when p_target_type = 'task' then p_target_id end,
        case when p_target_type = 'session' then p_target_id end,
        case when p_target_type = 'memory' then p_target_id end,
        'once', v_until, left(v_title, 300), v_tz
      );
      v_count := 1;
    end if;
  elsif p_action = 'not_today' then
    v_until := public.reminder_local_ts((v_now at time zone v_tz)::date + 1, time '00:00', v_tz);
    update public.reminders r
       set suppressed_until = v_until, snoozed_until = null
     where r.user_id = p_user and r.status = 'active'
       and ((p_target_type = 'task' and r.task_id = p_target_id)
         or (p_target_type = 'session' and r.session_id = p_target_id)
         or (p_target_type = 'memory' and r.memory_id = p_target_id));
    get diagnostics v_count = row_count;
  elsif p_action in ('stop', 'acknowledge') then
    update public.reminders r
       set status = case when p_action = 'stop' then 'stopped' else 'done' end,
           status_reason = case when p_action = 'stop' then 'user_stopped' else 'acknowledged' end
     where r.user_id = p_user and r.status = 'active'
       and ((p_target_type = 'task' and r.task_id = p_target_id)
         or (p_target_type = 'session' and r.session_id = p_target_id)
         or (p_target_type = 'memory' and r.memory_id = p_target_id));
    get diagnostics v_count = row_count;
  elsif p_action = 'resume' then
    update public.reminders r
       set snoozed_until = null, suppressed_until = null
     where r.user_id = p_user and r.status = 'active'
       and ((p_target_type = 'task' and r.task_id = p_target_id)
         or (p_target_type = 'session' and r.session_id = p_target_id)
         or (p_target_type = 'memory' and r.memory_id = p_target_id));
    get diagnostics v_count = row_count;
  else
    raise exception 'unknown action' using errcode = '22023';
  end if;

  return query
  select min(r.next_fire_at), v_until, v_count
    from public.reminders r
   where r.user_id = p_user and r.status = 'active'
     and ((p_target_type = 'task' and r.task_id = p_target_id)
       or (p_target_type = 'session' and r.session_id = p_target_id)
       or (p_target_type = 'memory' and r.memory_id = p_target_id));
end;
$$;

revoke all on function public.reminder_act(uuid, text, uuid, text, timestamptz) from public, anon;
grant execute on function public.reminder_act(uuid, text, uuid, text, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Deliveries (server-only writes) and the dispatcher's claim/mark calls
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  reminder_id uuid references public.reminders (id) on delete cascade,
  -- task:<id> / session:<id> / memory:<id> -- two rules of one target firing
  -- at the same moment reach each device once.
  target_key text not null,
  slot_at timestamptz not null,
  installation_id text not null,
  -- pending -> accepted (Expo took it) -> delivered (receipt ok) | failed;
  -- error (rejected, may retry); uncertain (no answer -- NOT retried, to
  -- avoid a double push); expired (too old to send); skipped (no longer due)
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'delivered', 'failed', 'error', 'uncertain', 'expired', 'skipped')),
  expo_ticket_id text,
  error text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, target_key, slot_at)
);
create index if not exists reminder_deliveries_receipts_idx on public.reminder_deliveries (created_at)
  where status = 'accepted' and receipt_checked_at is null;
create index if not exists reminder_deliveries_retry_idx on public.reminder_deliveries (next_attempt_at)
  where status = 'error' and next_attempt_at is not null;
create trigger set_reminder_deliveries_updated_at
  before update on public.reminder_deliveries
  for each row execute function public.set_updated_at();
alter table public.reminder_deliveries enable row level security;
create policy "Users can view their own deliveries"
  on public.reminder_deliveries for select
  using (auth.uid() = user_id);

/** Due reminders, leased so two overlapping dispatcher runs never take the same one. */
create or replace function public.reminders_claim_due(
  p_limit integer default 100,
  p_lease_seconds integer default 120,
  p_now timestamptz default null
)
returns table (
  reminder_id uuid,
  user_id uuid,
  slot_at timestamptz,
  target_type text,
  target_id uuid,
  kind text,
  purpose text,
  title text,
  note text,
  stale boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, public.reminder_now());
begin
  return query
  with picked as (
    select r.id
      from public.reminders r
     where r.status = 'active'
       and r.next_fire_at is not null
       and r.next_fire_at <= v_now
       and (r.lease_until is null or r.lease_until < v_now)
     order by r.next_fire_at
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  ),
  leased as (
    update public.reminders r
       set lease_until = v_now + make_interval(secs => p_lease_seconds)
      from picked
     where r.id = picked.id
    returning r.*
  )
  select l.id,
         l.user_id,
         l.next_fire_at,
         case when l.task_id is not null then 'task' when l.session_id is not null then 'session' else 'memory' end,
         coalesce(l.task_id, l.session_id, l.memory_id),
         l.kind,
         l.purpose,
         coalesce(t.title, l.title),
         l.note,
         -- More than 6 hours late (an outage): don't push it now, just move on.
         l.next_fire_at < v_now - interval '6 hours'
    from leased l
    left join public.tasks t on t.id = l.task_id;
end;
$$;

/** After a slot was handled: remember it and compute the next one (only if the schedule didn't change meanwhile). */
create or replace function public.reminders_mark_fired(p_reminder_id uuid, p_slot timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next timestamptz;
begin
  update public.reminders r
     set last_fired_at = greatest(coalesce(r.last_fired_at, '-infinity'::timestamptz), p_slot),
         snoozed_until = case when r.snoozed_until is not null and r.snoozed_until <= p_slot then null else r.snoozed_until end,
         lease_until = null
   where r.id = p_reminder_id and r.next_fire_at = p_slot
  returning r.next_fire_at into v_next;
  if not found then
    update public.reminders r set lease_until = null where r.id = p_reminder_id;
  end if;
  return v_next;
end;
$$;

revoke all on function public.reminders_claim_due(integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.reminders_mark_fired(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reminders_claim_due(integer, integer, timestamptz) to service_role;
grant execute on function public.reminders_mark_fired(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Spoken briefings: the text is reused while the items it covers haven't
-- changed; the last one's item order lets "the second one is done" work.
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content_hash text not null,
  lang text,
  voice text,
  items jsonb not null default '[]'::jsonb,
  script text not null,
  created_at timestamptz not null default now()
);
create index if not exists reminder_briefings_user_idx on public.reminder_briefings (user_id, created_at desc);
alter table public.reminder_briefings enable row level security;
create policy "Users can view their own briefings"
  on public.reminder_briefings for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Existing tasks: only open ones due today or later get the automatic
-- reminder (next_fire_at only ever lands in the future, so nothing old is
-- pushed in a burst).
-- ---------------------------------------------------------------------------
insert into public.reminders (user_id, task_id, kind, origin, title, timezone)
select t.user_id, t.id, 'due', 'default', left(t.title, 300), coalesce(nullif(p.timezone, ''), 'UTC')
  from public.tasks t
  left join public.profiles p on p.id = t.user_id
 where t.status = 'open'
   and t.due_date is not null
   and t.due_date >= (now() at time zone coalesce(nullif(p.timezone, ''), 'UTC'))::date
on conflict (task_id) where origin = 'default' do nothing;
