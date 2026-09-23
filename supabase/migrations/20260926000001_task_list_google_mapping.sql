-- Sending to Google Tasks per task list (still send-only, never a sync):
-- a task in one of the app's lists goes to the Google Tasks list with the
-- SAME NAME -- created in Google on first send if it doesn't exist yet --
-- unless the user picked a specific Google list for it (Tasks -> long-press
-- the list -> Google Tasks). Tasks in no list still go to the default list
-- chosen in Account -> Google Tasks (google_tasks_connections.default_list_id).
--
-- null = automatic (same name); set = the user's explicit choice. Only the
-- id is used for sending; the title is just what the app shows. Both are
-- plain values the owner already may update (see the task_lists update
-- policy) -- an id only ever takes effect with that user's own Google token.
alter table public.task_lists
  add column google_task_list_id text,
  add column google_task_list_title text;
