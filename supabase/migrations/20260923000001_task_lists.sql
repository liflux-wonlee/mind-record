-- Task lists: a purely in-app way to group tasks (e.g. "Shopping", "Work"),
-- independent of Google Tasks -- sending to Google still goes through the
-- single default list set in Account -> Google Tasks (see
-- supabase/migrations/20260920000001_google_tasks.sql); a local list here
-- has no link to a Google list at all.

create table public.task_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index task_lists_user_id_idx on public.task_lists (user_id);

create trigger set_task_lists_updated_at
  before update on public.task_lists
  for each row
  execute function public.set_updated_at();

alter table public.task_lists enable row level security;

create policy "Users can view their own task lists"
  on public.task_lists for select
  using (auth.uid() = user_id);

create policy "Users can insert their own task lists"
  on public.task_lists for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own task lists"
  on public.task_lists for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own task lists"
  on public.task_lists for delete
  using (auth.uid() = user_id);

-- ── per-task list assignment + starring ─────────────────────────────────
-- `list_suggestion` mirrors `topic_suggestion`: the AI's best-guess list
-- name when it wasn't confident enough to assign `list_id` outright (see
-- supabase/functions/process-session) -- surfaced as a confirm/correct
-- prompt on Summary, same as topic suggestions already are.
alter table public.tasks
  add column list_id uuid references public.task_lists (id) on delete set null,
  add column list_suggestion text,
  add column starred boolean not null default false;

create index tasks_list_id_idx on public.tasks (list_id);
create index tasks_starred_idx on public.tasks (starred) where starred;

create or replace function public.check_owned_task_list()
returns trigger
language plpgsql
as $$
begin
  if new.list_id is not null then
    if not exists (select 1 from public.task_lists l where l.id = new.list_id and l.user_id = new.user_id) then
      raise exception 'list_id must belong to the same user';
    end if;
  end if;
  return new;
end;
$$;

create trigger check_tasks_list_owner
  before insert or update on public.tasks
  for each row
  execute function public.check_owned_task_list();
