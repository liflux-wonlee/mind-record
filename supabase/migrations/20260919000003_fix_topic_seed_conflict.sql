-- The topic-hierarchy migration (20260914000002_topic_hierarchy.sql)
-- dropped the original `unique (user_id, name)` constraint that this
-- trigger's `on conflict (user_id, name)` targeted, replacing it with two
-- PARTIAL unique indexes (top-level vs. child). Postgres can only infer a
-- conflict target that matches a constraint/index's column list AND
-- predicate exactly, so the old clause no longer matches anything: every
-- new signup's seed insert throws "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification", which fails the
-- `auth.users` insert transaction and breaks signup entirely.
--
-- The seeded topics are always top-level (no parent_topic_id), so this
-- points the conflict target at topics_user_top_level_name_idx instead.
create or replace function public.handle_new_user_topics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.topics (user_id, name)
  values
    (new.id, 'Business'),
    (new.id, 'Faith'),
    (new.id, 'Personal'),
    (new.id, 'Family'),
    (new.id, 'Ideas'),
    (new.id, 'Other')
  on conflict (user_id, name) where parent_topic_id is null do nothing;
  return new;
end;
$$;
