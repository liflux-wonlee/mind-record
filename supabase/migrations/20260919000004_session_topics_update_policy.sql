-- session_topics only ever got select/insert/delete RLS policies
-- (20260913000003_topics.sql), but merge_topics() (20260914000002_
-- topic_hierarchy.sql) runs `update session_topics set topic_id = ...`
-- under `security invoker` -- with no matching UPDATE policy, that
-- statement matches zero rows under RLS and silently no-ops, leaving some
-- of the merged topic's session links still pointing at the now-deleted
-- source topic (a dangling foreign key the surrounding DELETE then fails
-- on, or -- if the delete of the source topic itself is what cascades
-- those rows away -- an outright loss of the session/topic link, not a
-- re-point).
create policy "Users can repoint links for their own sessions and topics"
  on public.session_topics for update
  using (
    exists (select 1 from public.sessions s where s.id = session_topics.session_id and s.user_id = auth.uid())
    and exists (select 1 from public.topics t where t.id = session_topics.topic_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.sessions s where s.id = session_topics.session_id and s.user_id = auth.uid())
    and exists (select 1 from public.topics t where t.id = session_topics.topic_id and t.user_id = auth.uid())
  );
