-- A short `summary` (1-2 sentences) stays useful for compact surfaces
-- (Home's "Continue conversation", Calendar rows, Journal's daily recap) --
-- but flattening an entire recording down to one line was throwing away
-- real content. `outline` holds a full structured breakdown (see
-- supabase/functions/process-session) that the Summary screen's Summary
-- tab renders in full instead.
alter table public.sessions
  add column outline jsonb;
