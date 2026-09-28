-- Favorites: the user can star a record (a session) or a topic, like tasks
-- already can (tasks.starred). Records has a Starred view and Topics shows
-- starred topics in a Favorites section at the top.
--
-- The existing owner-only update policies on sessions and topics already
-- cover this column; nothing else changes.

alter table public.sessions
  add column if not exists starred boolean not null default false;

alter table public.topics
  add column if not exists starred boolean not null default false;

-- Records' Starred view pages through a user's starred sessions newest first.
create index if not exists sessions_user_starred_idx
  on public.sessions (user_id, started_at desc)
  where starred;
