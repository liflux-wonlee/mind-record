-- Server-side search across everything a user has: recordings (title,
-- summary, full transcript), tasks and ideas. Replaces the Search tab's
-- client-side filter over the 100 most recent rows, which could never find
-- anything older or anything said inside a transcript.
--
-- `security invoker`: every statement runs under the caller's own RLS, so
-- it can only ever return the caller's rows (same reasoning as
-- merge_topics in 20260914000002_topic_hierarchy.sql).

create extension if not exists pg_trgm with schema extensions;

-- Trigram indexes so ilike '%q%' stays fast as transcripts pile up. The
-- opclass is schema-qualified: pg_trgm installs into the `extensions`
-- schema above (Supabase's recommended location, not `public`), and the
-- role running migrations doesn't necessarily have that schema on its
-- search_path -- an unqualified `gin_trgm_ops` then fails to resolve at
-- all ("operator class gin_trgm_ops does not exist for access method gin").
create index if not exists sessions_transcript_trgm_idx on public.sessions using gin (raw_transcript extensions.gin_trgm_ops);
create index if not exists sessions_summary_trgm_idx on public.sessions using gin (summary extensions.gin_trgm_ops);
create index if not exists sessions_title_trgm_idx on public.sessions using gin (title extensions.gin_trgm_ops);
create index if not exists tasks_title_trgm_idx on public.tasks using gin (title extensions.gin_trgm_ops);
create index if not exists memories_content_trgm_idx on public.memories using gin (content extensions.gin_trgm_ops);

-- A ~140-char window around the first match, so the result row shows the
-- matching sentence rather than the start of a long transcript.
create or replace function public.search_snippet(body text, q text)
returns text
language sql
immutable
as $$
  select case
    when body is null then null
    when position(lower(q) in lower(body)) = 0 then left(body, 140)
    else
      (case when position(lower(q) in lower(body)) > 60 then '…' else '' end)
      || substr(body, greatest(1, position(lower(q) in lower(body)) - 60), 140)
      || (case when position(lower(q) in lower(body)) - 60 + 140 < length(body) then '…' else '' end)
  end
$$;

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
      and m.content ilike (select pat from needle)
  ) hits
  order by happened_at desc
  limit greatest(1, least(max_results, 200));
$$;

grant execute on function public.search_snippet(text, text) to authenticated;
grant execute on function public.search_everything(text, int) to authenticated;
