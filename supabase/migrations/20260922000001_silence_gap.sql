-- How long a pause in speech (ms) before Conversation mode treats the
-- user's turn as over and sends it to the AI -- see
-- src/hooks/useConversationSession.ts's SILENCE_DURATION_MS, now a
-- per-user default instead of a fixed constant. Bounds match what's
-- actually usable: MIN_RECORDING_MS (800ms) is the shortest a turn can be
-- padded to already, and above ~3s a "pause" stops feeling like a pause.
alter table public.profiles
  add column silence_gap_ms integer not null default 1500
  constraint profiles_silence_gap_ms_check check (silence_gap_ms between 800 and 3000);
