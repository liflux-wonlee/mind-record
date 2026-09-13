-- Sessions (one voice/text capture session) and the messages inside them.
--
-- `messages.position` gives a stable order within a session that doesn't
-- depend on clock resolution; `set_message_position()` fills it in
-- automatically so callers never have to compute "the next number".
--
-- `messages.user_id` is denormalized from `sessions.user_id` on purpose —
-- see the RLS policies below for why (§16 of the phase brief: a child table
-- must not let one user attach rows to another user's session).

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  mode text not null check (mode in ('capture', 'conversation', 'driving')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  raw_transcript text,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sessions_user_id_idx on public.sessions (user_id);
create index sessions_started_at_idx on public.sessions (started_at desc);

create trigger set_sessions_updated_at
  before update on public.sessions
  for each row
  execute function public.set_updated_at();

alter table public.sessions enable row level security;

create policy "Users can view their own sessions"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own sessions"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own sessions"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own sessions"
  on public.sessions for delete
  using (auth.uid() = user_id);

-- ── messages ────────────────────────────────────────────────────────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (session_id, position)
);

create index messages_session_id_idx on public.messages (session_id);
create index messages_user_id_idx on public.messages (user_id);

-- Auto-number messages within a session so callers don't have to compute it.
create or replace function public.set_message_position()
returns trigger
language plpgsql
as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1
    into new.position
    from public.messages
    where session_id = new.session_id;
  end if;
  return new;
end;
$$;

create trigger set_messages_position
  before insert on public.messages
  for each row
  execute function public.set_message_position();

alter table public.messages enable row level security;

-- A message must belong both to its stated owner AND to a session that
-- owner actually owns -- this is what stops user A from writing a message
-- into user B's session by guessing/reusing a session_id.
create policy "Users can view messages in their own sessions"
  on public.messages for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

create policy "Users can insert messages into their own sessions"
  on public.messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );

create policy "Users can delete messages in their own sessions"
  on public.messages for delete
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.sessions s
      where s.id = messages.session_id and s.user_id = auth.uid()
    )
  );
