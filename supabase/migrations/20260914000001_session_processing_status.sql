-- Tracks the async transcribe-then-analyze pipeline the `process-session`
-- Edge Function runs after a recording ends (see supabase/functions/
-- process-session). The app polls this column to show a real "processing"
-- state on the Summary screen instead of pretending results are instant.

alter table public.sessions
  add column processing_status text not null default 'pending'
    check (processing_status in ('pending', 'transcribing', 'analyzing', 'done', 'error')),
  add column processing_error text;
