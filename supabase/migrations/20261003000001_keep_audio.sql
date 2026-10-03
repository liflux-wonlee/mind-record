-- Original recordings are kept (they used to be deleted once a session was
-- processed), and processing a long recording can span several Edge
-- Function runs.
--
-- attachments.transcript / duration_seconds / language: each audio
-- segment's Whisper result, saved as soon as it's transcribed, so a run that
-- runs out of time (or dies) picks up where it stopped instead of
-- re-transcribing -- and re-billing -- every segment.
--
-- profiles.audio_retention_days: how long originals are kept. null = keep
-- (the default), 30 / 90 = deleted that many days after the recording was
-- processed, 0 = deleted as soon as it's processed (the old behaviour).
-- The deleting is done by reminders-dispatch, which the existing per-minute
-- cron wakes when something is due (see reminders_cron_tick below).

alter table public.attachments
  add column if not exists transcript text,
  add column if not exists duration_seconds numeric,
  add column if not exists language text;

alter table public.profiles
  add column if not exists audio_retention_days integer;

alter table public.profiles drop constraint if exists profiles_audio_retention_days_check;
alter table public.profiles
  add constraint profiles_audio_retention_days_check
  check (audio_retention_days is null or audio_retention_days in (0, 30, 90));

create index if not exists attachments_audio_created_idx
  on public.attachments (created_at)
  where type = 'audio';

-- Audio files whose owner's retention period has passed (only for sessions
-- that finished processing -- a recording still waiting for a Retry is
-- never deleted). Service role only.
create or replace function public.audio_retention_expired(p_limit integer default 200)
returns table (id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.storage_path
    from public.attachments a
    join public.profiles p on p.id = a.user_id
    join public.sessions s on s.id = a.session_id
   where a.type = 'audio'
     and p.audio_retention_days is not null
     and p.audio_retention_days > 0
     and s.processing_status = 'done'
     and a.created_at < now() - make_interval(days => p.audio_retention_days)
   order by a.created_at
   limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.audio_retention_expired(integer) from public, anon, authenticated;
grant execute on function public.audio_retention_expired(integer) to service_role;

-- Same as 20260929000002_reminders_cron.sql, plus: also wake the
-- dispatcher when recordings are past their retention period.
create or replace function public.reminders_cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'reminders_dispatch_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'reminders_cron_secret';
  exception when others then
    return; -- no Vault here (local tests)
  end;
  if v_url is null or v_secret is null then
    return;
  end if;
  if not exists (select 1 from public.reminders where status = 'active' and next_fire_at <= now())
     and not exists (select 1 from public.reminder_deliveries where status = 'error' and next_attempt_at <= now())
     and not exists (
       select 1 from public.reminder_deliveries
        where status = 'accepted' and receipt_checked_at is null and created_at < now() - interval '15 minutes'
     )
     and not exists (select 1 from public.audio_retention_expired(1)) then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 30000)'
    using v_url,
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          '{}'::jsonb;
end;
$$;

revoke all on function public.reminders_cron_tick() from public, anon, authenticated;
