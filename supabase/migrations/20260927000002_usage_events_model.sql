-- Which OpenAI model a usage row was for. Speech synthesis now uses two
-- models (tts-1 for the original voices, gpt-4o-mini-tts for Marin -- see
-- supabase/functions/_shared/voices.ts) that are priced differently, so a
-- character count alone no longer says what a row cost.
--
-- Nullable: rows from before this -- and events that don't pass one -- are
-- the functions' long-standing defaults (whisper-1, gpt-4o-mini, tts-1).
-- recordUsage only sends the column when it has a value, so functions
-- deployed before this migration keep writing their rows.
alter table public.usage_events
  add column model text;
