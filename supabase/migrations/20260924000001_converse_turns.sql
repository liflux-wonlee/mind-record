-- Conversation-mode turns can now read and change app data by voice
-- (supabase/functions/converse/tools.ts). Three supporting changes:

-- ── 1. Turn idempotency ────────────────────────────────────────────────
-- converse tags every row a turn writes (the user's words, the AI's reply,
-- and any '[action]' log rows) with the client's turnId. A request retried
-- after a dropped connection -- which may already have added a task --
-- then replays the stored reply instead of running the tools a second time.
alter table public.messages add column client_turn_id text;

create unique index messages_session_turn_role_idx
  on public.messages (session_id, client_turn_id, role)
  where client_turn_id is not null and role in ('user', 'assistant');

create index messages_session_turn_idx
  on public.messages (session_id, client_turn_id)
  where client_turn_id is not null;

-- ── 2. Clients can't write the action log ──────────────────────────────
-- Only converse (service role) writes messages; the app itself never does.
-- Limit client inserts to plain user/assistant text so the role 'system'
-- action log that undo_last_action acts on can't be forged from a client.
drop policy "Users can insert messages into their own sessions" on public.messages;

create policy "Users can insert messages into their own sessions"
  on public.messages for insert
  with check (
    role in ('user', 'assistant')
    and auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

-- ── 3. search_everything fails closed ──────────────────────────────────
-- It relied on RLS alone (`security invoker`), so a call made through the
-- service-role client by mistake would have searched every user's records.
-- auth.uid() is null under the service role, so these filters make such a
-- misuse return nothing instead. Same signature and body otherwise.
create or replace function public.search_everything(q text, max_results int default 60)
returns table (
  kind text,
  id uuid,
  title text,
  snippet text,
  happened_at timestamptz,
  session_id uuid,
  topic_id uuid
)
language sql
stable
security invoker
as $$
  with needle as (select '%' || trim(q) || '%' as pat)
  select * from (
    select
      'session'::text as kind,
      s.id,
      coalesce(s.title, s.summary, 'Untitled recording') as title,
      public.search_snippet(
        case
          when s.raw_transcript ilike (select pat from needle) then s.raw_transcript
          when s.summary ilike (select pat from needle) then s.summary
          else s.title
        end,
        trim(q)
      ) as snippet,
      s.started_at as happened_at,
      s.id as session_id,
      null::uuid as topic_id
    from public.sessions s
    where trim(q) <> ''
      and s.user_id = auth.uid()
      and (s.title ilike (select pat from needle)
        or s.summary ilike (select pat from needle)
        or s.raw_transcript ilike (select pat from needle))

    union all

    select
      'task'::text,
      t.id,
      t.title,
      public.search_snippet(coalesce(t.description, t.title), trim(q)),
      t.created_at,
      t.source_session_id,
      t.topic_id
    from public.tasks t
    where trim(q) <> ''
      and t.user_id = auth.uid()
      and (t.title ilike (select pat from needle) or t.description ilike (select pat from needle))

    union all

    select
      'memory'::text,
      m.id,
      left(m.content, 80),
      public.search_snippet(m.content, trim(q)),
      m.created_at,
      m.source_session_id,
      m.topic_id
    from public.memories m
    where trim(q) <> ''
      and m.user_id = auth.uid()
      and m.content ilike (select pat from needle)
  ) hits
  order by happened_at desc
  limit greatest(1, least(max_results, 200));
$$;
