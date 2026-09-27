-- Typed notes: for when the user can't talk out loud (a meeting, a quiet
-- room, a noisy street), Home's "Type instead" (app/note.tsx) saves what
-- they type as a normal record. It is a `sessions` row like any capture --
-- same Summary screen, same process-session analysis (title, summary,
-- outline, tasks, ideas, topics) -- just with no audio: the typed text is
-- written straight into raw_transcript, and process-session uses it as the
-- transcript instead of running Whisper.
--
-- Deploy order: apply this migration AND deploy process-session before the
-- app build with "Type instead" ships. Without the migration the insert
-- fails sessions_mode_check (the app says a server update is needed);
-- without the new function an old deploy rejects the note as "No audio"
-- (Retry recovers once it is deployed).
--
-- The original inline check (20260913000002_sessions_messages.sql) got
-- Postgres' default name, sessions_mode_check; widen it to allow 'note'.
alter table public.sessions
  drop constraint if exists sessions_mode_check;

alter table public.sessions
  add constraint sessions_mode_check
    check (mode in ('capture', 'conversation', 'driving', 'note'));

-- The whole note goes to the analysis model in one call, so it is capped
-- (app/note.tsx's input and process-session use the same 20,000 limit).
alter table public.sessions
  drop constraint if exists sessions_note_length;

alter table public.sessions
  add constraint sessions_note_length
    check (mode <> 'note' or char_length(raw_transcript) <= 20000);
