-- Topic hierarchy (major category -> sub-topic), per-item topic assignment
-- on tasks/memories (replacing "the whole session touches these topics"
-- with "this specific task/idea belongs to this specific topic"), and a
-- safe merge_topics() RPC for the Topic management screen.

-- ── topics: parent/child ────────────────────────────────────────────────
alter table public.topics
  add column parent_topic_id uuid references public.topics (id) on delete set null;

alter table public.topics
  add constraint topics_parent_not_self check (parent_topic_id is distinct from id);

create index topics_parent_topic_id_idx on public.topics (parent_topic_id);

-- A parent must belong to the same user -- otherwise a topic could be
-- nested under someone else's topic. Enforced via trigger (not RLS) since
-- this is a same-table self-reference, not a cross-table check.
create or replace function public.check_topic_parent_owner()
returns trigger
language plpgsql
as $$
begin
  if new.parent_topic_id is not null then
    if not exists (
      select 1 from public.topics p
      where p.id = new.parent_topic_id and p.user_id = new.user_id
    ) then
      raise exception 'parent_topic_id must belong to the same user';
    end if;
  end if;
  return new;
end;
$$;

create trigger check_topics_parent_owner
  before insert or update on public.topics
  for each row
  execute function public.check_topic_parent_owner();

-- The original `unique (user_id, name)` doesn't work once topics can be
-- nested -- "General" should be allowed once at the top level and again
-- under a different parent, but not duplicated as siblings. Two partial
-- unique indexes replace it (a single `unique (user_id, parent_topic_id,
-- name)` wouldn't catch top-level duplicates, since Postgres treats every
-- NULL parent_topic_id as distinct).
alter table public.topics drop constraint topics_user_id_name_key;

create unique index topics_user_top_level_name_idx
  on public.topics (user_id, name) where parent_topic_id is null;

create unique index topics_user_child_name_idx
  on public.topics (user_id, parent_topic_id, name) where parent_topic_id is not null;

-- ── per-item topic assignment on tasks/memories ─────────────────────────
-- `topic_suggestion` holds the AI's best-guess topic name when it wasn't
-- confident enough to assign `topic_id` outright (see supabase/functions/
-- process-session) -- the app surfaces these as a confirm/correct prompt
-- on the Summary screen rather than silently guessing.
alter table public.tasks
  add column topic_id uuid references public.topics (id) on delete set null,
  add column topic_suggestion text;

alter table public.memories
  add column topic_id uuid references public.topics (id) on delete set null,
  add column topic_suggestion text;

create index tasks_topic_id_idx on public.tasks (topic_id);
create index memories_topic_id_idx on public.memories (topic_id);

create or replace function public.check_owned_topic()
returns trigger
language plpgsql
as $$
begin
  if new.topic_id is not null then
    if not exists (select 1 from public.topics t where t.id = new.topic_id and t.user_id = new.user_id) then
      raise exception 'topic_id must belong to the same user';
    end if;
  end if;
  return new;
end;
$$;

create trigger check_tasks_topic_owner
  before insert or update on public.tasks
  for each row
  execute function public.check_owned_topic();

create trigger check_memories_topic_owner
  before insert or update on public.memories
  for each row
  execute function public.check_owned_topic();

-- ── merge_topics RPC ─────────────────────────────────────────────────────
-- Used by the Topic management screen (src/services/topics.ts's
-- mergeTopics). Deliberately `security invoker`, not `security definer`:
-- every statement inside runs with the CALLING user's own RLS, so passing
-- someone else's topic id (or a nonexistent one) just matches zero rows
-- instead of needing an explicit ownership check here.
create or replace function public.merge_topics(source_id uuid, target_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if source_id = target_id then
    raise exception 'Cannot merge a topic into itself.';
  end if;

  update public.tasks set topic_id = target_id where topic_id = source_id;
  update public.memories set topic_id = target_id where topic_id = source_id;
  update public.topics set parent_topic_id = target_id where parent_topic_id = source_id;

  -- Drop any session_topics link to the source that would collide with an
  -- existing link to the target for the same session, then re-point the rest.
  delete from public.session_topics st
    where st.topic_id = source_id
      and exists (
        select 1 from public.session_topics st2
        where st2.session_id = st.session_id and st2.topic_id = target_id
      );
  update public.session_topics set topic_id = target_id where topic_id = source_id;

  delete from public.topics where id = source_id;
end;
$$;

grant execute on function public.merge_topics(uuid, uuid) to authenticated;
