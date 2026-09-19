-- tasks.due_date was `timestamptz`, but every write (src/services/tasks.ts)
-- and read (app/(tabs)/tasks.tsx) has only ever treated it as a bare
-- date-only value ('YYYY-MM-DD', no time-of-day) -- the app just never
-- had a real DATE column to store that in. A bare date string with no
-- time/offset is interpreted by Postgres as midnight in the session's
-- timezone (UTC, for this project), so the stored instant already *is*
-- exactly the calendar date the user picked; the only bug was on the way
-- back out, where parsing that timestamp as a JS Date and formatting it in
-- the device's local zone could roll it back a day.
--
-- Converting the column itself to `date` removes the ambiguity at the
-- source instead of continuing to patch it on read: `AT TIME ZONE 'UTC'`
-- recovers the original calendar date regardless of whatever timezone this
-- migration happens to run under, so existing due dates are preserved
-- exactly as the user set them.
alter table public.tasks
  alter column due_date type date using (due_date at time zone 'utc')::date;
