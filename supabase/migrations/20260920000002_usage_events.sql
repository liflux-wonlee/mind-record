-- Usage measurement foundation (§11 of the spec): records what AI
-- processing actually cost -- audio transcribed, GPT tokens, TTS
-- characters -- completely separate from any quota/entitlement decision.
-- Nothing here enforces a limit or knows about a plan; it's purely a
-- ledger of real usage for whatever billing policy gets built later, once
-- pricing is actually decided. Plan/entitlement/billing-expiry fields
-- deliberately do NOT live in `profiles` (which the app lets the user
-- edit fields of, like their name and voice) or anywhere else
-- client-writable -- this table has no client INSERT/UPDATE/DELETE policy
-- at all, only a read policy so the app can eventually show the user
-- their own usage; every write comes from an Edge Function's service-role
-- client.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('transcribe', 'gpt_completion', 'tts_synthesize')),
  source text not null check (source in ('process_session', 'converse', 'search_ask', 'preview_voice')),
  session_id uuid references public.sessions (id) on delete set null,
  -- Stable across retries of the SAME logical operation (e.g. re-running
  -- process-session for one session after a failure), so a later
  -- successful attempt overwrites the earlier one's row for that
  -- operation instead of adding another charge on top of it -- protects
  -- the user's future quota from being charged repeatedly for what looks
  -- to them like one action, even though each real attempt (transcribing
  -- again, calling GPT again) did cost real API usage each time. Left
  -- null for events that don't have a natural "same logical operation"
  -- key to retry under (e.g. one conversation turn, already protected
  -- from double-invocation by the client's network-error-only retry
  -- policy; one search question, never retried as "the same" question) --
  -- those rows are never deduped, each insert stands on its own.
  dedupe_key text,
  audio_seconds numeric,
  audio_bytes bigint,
  input_tokens integer,
  output_tokens integer,
  tts_characters integer,
  succeeded boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

-- Multiple NULLs are allowed through a unique index same as a unique
-- constraint -- only rows that DO specify a dedupe_key collide with each
-- other, which is exactly the "some events dedupe, most don't" split above.
create unique index usage_events_dedupe_key_idx on public.usage_events (dedupe_key) where dedupe_key is not null;
create index usage_events_user_id_idx on public.usage_events (user_id, created_at desc);

alter table public.usage_events enable row level security;

create policy "Users can view their own usage events"
  on public.usage_events for select
  using (auth.uid() = user_id);
