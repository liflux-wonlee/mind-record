-- "Send to Google Tasks" (§10 of the spec): connecting a Google account
-- for Tasks access is entirely separate from whichever provider (Google/
-- Apple/email) the user actually signed into Mind Record with, and this
-- connection's tokens must never be confused with the login session's own
-- tokens. Every table here is readable ONLY by the service role -- no RLS
-- select policy grants the client anything, including the connections
-- table, so a refresh token can never reach the app even by accident; the
-- app learns "connected, as whom, default list" through a dedicated
-- Edge Function (google-tasks-status) that strips the token fields.

-- Short-lived, single-use, bound to the user who started the connect flow.
-- Necessary because the OAuth callback is hit directly by Google's browser
-- redirect -- there is no Authorization header/JWT of our own on that
-- request to identify the user from, so the user has to be looked up via
-- this state value instead.
create table public.google_tasks_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.google_tasks_oauth_states enable row level security;

-- One Google Tasks connection per Mind Record user. Reconnecting (e.g. a
-- different Google account) just overwrites this row's tokens -- it never
-- touches auth.users or any content table, so the Mind Record account and
-- its records are unaffected either way.
create table public.google_tasks_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  google_sub text not null,
  google_email text not null,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  default_list_id text,
  default_list_title text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_tasks_connections enable row level security;

create trigger set_google_tasks_connections_updated_at
  before update on public.google_tasks_connections
  for each row execute function public.set_updated_at();

-- One row per local item successfully sent -- both the idempotency record
-- ("was this task already sent to this list? don't insert a duplicate on
-- retry/double-tap") and what the app's "Sent" status reads. Exactly one
-- of task_id/memory_id is set; the unique constraints are per-column so a
-- task and a memory can never collide with each other, and deleting the
-- source task/memory here only removes MIND RECORD's own record of having
-- sent it -- it never touches the task that already exists in Google Tasks.
create table public.google_tasks_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  memory_id uuid references public.memories (id) on delete cascade,
  google_task_list_id text not null,
  google_task_list_title text,
  google_task_id text not null,
  sent_at timestamptz not null default now(),
  constraint google_tasks_sends_exactly_one_item check (
    (task_id is not null and memory_id is null) or (task_id is null and memory_id is not null)
  ),
  unique (task_id, google_task_list_id),
  unique (memory_id, google_task_list_id)
);
create index google_tasks_sends_task_idx on public.google_tasks_sends (task_id);
create index google_tasks_sends_memory_idx on public.google_tasks_sends (memory_id);
alter table public.google_tasks_sends enable row level security;

-- The app DOES read this one directly (to show "Sent" on a task/idea) --
-- it carries no token, only the fact and result of a send.
create policy "Users can view their own Google Tasks sends"
  on public.google_tasks_sends for select
  using (auth.uid() = user_id);
