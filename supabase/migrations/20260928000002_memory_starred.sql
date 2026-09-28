-- Favorites, part 2: ideas (memories) can be starred too, so every card on
-- a Topic page -- recordings, tasks and ideas -- carries its own star
-- (sessions/topics got theirs in 20260928000001, tasks already had one).
-- The existing owner-only update policy on memories covers this column.

alter table public.memories
  add column if not exists starred boolean not null default false;
