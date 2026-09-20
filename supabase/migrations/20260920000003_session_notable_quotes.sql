-- Standout, verbatim lines worth pulling out on their own -- distinct from
-- `outline`'s paraphrased bullets (see supabase/functions/process-session's
-- analyzeTranscript). Populated only when the recording actually has
-- something quote-worthy (a sermon, a talk, a meaningful conversation); a
-- plain empty array, not null, so the Summary screen can render it with no
-- extra null-check.
alter table public.sessions
  add column notable_quotes text[] not null default '{}';
