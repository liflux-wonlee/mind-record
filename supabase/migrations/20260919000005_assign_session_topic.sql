-- src/services/topics.ts's assignSessionTopic() used to run its
-- delete-then-insert-then-clear-suggestion sequence as three separate
-- round trips -- a failure between any two of them (network drop, app
-- backgrounded mid-call) could leave a session with NO topic link at all
-- (deleted the old one, never inserted the new one) or still showing a
-- stale AI suggestion despite already being filed. Wrapping all three
-- statements in one `security invoker` function makes them atomic: they
-- run as a single statement from the caller's side, so a failure partway
-- through rolls the whole thing back instead of leaving it half-done.
create or replace function public.assign_session_topic(p_session_id uuid, p_topic_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  delete from public.session_topics where session_id = p_session_id;
  insert into public.session_topics (session_id, topic_id, confidence)
  values (p_session_id, p_topic_id, null);
  update public.sessions set topic_suggestion = null where id = p_session_id;
end;
$$;

grant execute on function public.assign_session_topic(uuid, uuid) to authenticated;
