-- Runs the reminder dispatcher (supabase/functions/reminders-dispatch)
-- every minute with pg_cron + pg_net, so reminders go out even when nobody
-- has the app open.
--
-- The function URL and the shared secret live in Supabase Vault (never in
-- this repo). Create them once in the SQL editor -- see docs/REMINDERS.md:
--
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/reminders-dispatch', 'reminders_dispatch_url');
--   select vault.create_secret('<long random string>', 'reminders_cron_secret');
--
-- and set the same secret on the function:
--   supabase secrets set REMINDERS_CRON_SECRET=<same string>
--
-- Until both secrets exist the tick does nothing.

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
  -- Only wake the function when there is work: a due slot, a retry, or
  -- push receipts waiting to be checked.
  if not exists (select 1 from public.reminders where status = 'active' and next_fire_at <= now())
     and not exists (select 1 from public.reminder_deliveries where status = 'error' and next_attempt_at <= now())
     and not exists (
       select 1 from public.reminder_deliveries
        where status = 'accepted' and receipt_checked_at is null and created_at < now() - interval '15 minutes'
     ) then
    return;
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 30000)'
    using v_url,
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          '{}'::jsonb;
end;
$$;

revoke all on function public.reminders_cron_tick() from public, anon, authenticated;

-- pg_cron / pg_net exist on Supabase; a plain local Postgres (tests) just
-- skips the schedule.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('reminders-dispatch', '* * * * *', 'select public.reminders_cron_tick()');
  else
    raise notice 'pg_cron/pg_net not available: reminders-dispatch is not scheduled here';
  end if;
end $$;
