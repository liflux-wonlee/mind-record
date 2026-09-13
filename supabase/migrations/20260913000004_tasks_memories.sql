-- Tasks (extracted to-dos) and memories (long-term recall material).
--
-- Both carry an optional `source_session_id` pointing back to the
-- conversation they came from, per the plan's "every task remembers why it
-- exists" principle — but a task or memory can also stand alone (created
-- directly, with no session), so the column is nullable.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_session_id uuid references public.sessions (id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_source_session_id_idx on public.tasks (source_session_id);
create index tasks_status_idx on public.tasks (status);

create trigger set_tasks_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

alter table public.tasks enable row level security;

-- source_session_id, when set, must point at a session the same user owns --
-- otherwise a task could cite someone else's conversation as its source.
create policy "Users can view their own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tasks"
  on public.tasks for insert
  with check (
    auth.uid() = user_id
    and (
      source_session_id is null
      or exists (select 1 from public.sessions s where s.id = tasks.source_session_id and s.user_id = auth.uid())
    )
  );

create policy "Users can update their own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      source_session_id is null
      or exists (select 1 from public.sessions s where s.id = tasks.source_session_id and s.user_id = auth.uid())
    )
  );

create policy "Users can delete their own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

-- ── memories ────────────────────────────────────────────────────────────
-- `embedding` isn't added yet -- semantic search is a later phase -- but the
-- shape is ready for it. Once pgvector is enabled, add it with:
--   create extension if not exists vector;
--   alter table public.memories add column embedding vector(1536);
--   create index memories_embedding_idx on public.memories
--     using hnsw (embedding vector_cosine_ops);
-- (1536 matches OpenAI text-embedding-3-small; adjust to whatever model is
-- actually used when that phase happens.)
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_session_id uuid references public.sessions (id) on delete set null,
  content text not null,
  category text,
  importance smallint check (importance is null or (importance between 1 and 5)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memories_user_id_idx on public.memories (user_id);
create index memories_source_session_id_idx on public.memories (source_session_id);

create trigger set_memories_updated_at
  before update on public.memories
  for each row
  execute function public.set_updated_at();

alter table public.memories enable row level security;

create policy "Users can view their own memories"
  on public.memories for select
  using (auth.uid() = user_id);

create policy "Users can insert their own memories"
  on public.memories for insert
  with check (
    auth.uid() = user_id
    and (
      source_session_id is null
      or exists (select 1 from public.sessions s where s.id = memories.source_session_id and s.user_id = auth.uid())
    )
  );

create policy "Users can update their own memories"
  on public.memories for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      source_session_id is null
      or exists (select 1 from public.sessions s where s.id = memories.source_session_id and s.user_id = auth.uid())
    )
  );

create policy "Users can delete their own memories"
  on public.memories for delete
  using (auth.uid() = user_id);
