-- Every recording gets filed under a topic, not just the tasks/ideas
-- pulled out of it. process-session now asks the model for the ONE topic
-- the recording as a whole is about and links it in session_topics when
-- confident; below the confidence threshold the guess lands here instead
-- and Summary asks the user to confirm it (same flow as
-- tasks.topic_suggestion / memories.topic_suggestion).
--
-- Before this, a plain journal entry with nothing to file as a task or
-- idea never got a topic at all and just sat in "Unclassified".

alter table public.sessions
  add column topic_suggestion text;
