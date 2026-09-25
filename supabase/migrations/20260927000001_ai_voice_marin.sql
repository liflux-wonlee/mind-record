-- Adds OpenAI's "marin" voice to the AI voice choices (Settings -> AI).
-- marin is only available on the gpt-4o-mini-tts model, so the Edge
-- Functions pick that model for it (see supabase/functions/_shared/
-- voices.ts); the existing voices keep using tts-1. Every earlier value
-- stays allowed, so no existing profile row is affected.
alter table public.profiles
  drop constraint profiles_ai_voice_check;

alter table public.profiles
  add constraint profiles_ai_voice_check
  check (ai_voice in ('alloy', 'echo', 'onyx', 'nova', 'shimmer', 'marin'));
