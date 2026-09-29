-- The spoken reminder briefing (supabase/functions/reminder-briefing) spends
-- GPT tokens and TTS characters like the other AI features, so its usage is
-- recorded under its own source.
alter table public.usage_events drop constraint if exists usage_events_source_check;
alter table public.usage_events
  add constraint usage_events_source_check
  check (source in ('process_session', 'converse', 'search_ask', 'preview_voice', 'reminder_briefing'));
