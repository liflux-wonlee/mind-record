-- AI name / user honorific / TTS voice -- per-account settings the
-- conversational AI (supabase/functions/converse) reads to personalize
-- how it addresses the user and what it sounds like.
--
-- ai_voice is constrained to the small set of OpenAI TTS voices the app
-- actually offers a preview for (see ALLOWED_VOICES in
-- supabase/functions/preview-voice/index.ts and converse/index.ts) --
-- validated here too so a bad value can never reach the TTS API call.

alter table public.profiles
  add column ai_name text,
  add column user_honorific text,
  add column ai_voice text not null default 'alloy';

alter table public.profiles
  add constraint profiles_ai_voice_check
  check (ai_voice in ('alloy', 'echo', 'onyx', 'nova', 'shimmer'));

alter table public.profiles
  add constraint profiles_ai_name_length check (char_length(ai_name) <= 40);

alter table public.profiles
  add constraint profiles_user_honorific_length check (char_length(user_honorific) <= 40);
