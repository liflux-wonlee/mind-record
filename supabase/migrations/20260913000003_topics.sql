-- Topics (Business / Faith / Personal / ... ) and the join table that links
-- sessions to the topics they touch on. Topics are per-user rows, not a
-- fixed enum, so users can rename or add their own later; a handful of
-- defaults are seeded for every new user by the same trigger that creates
-- their profile.

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index topics_user_id_idx on public.topics (user_id);

create trigger set_topics_updated_at
  before update on public.topics
  for each row
  execute function public.set_updated_at();

alter table public.topics enable row level security;

create policy "Users can view their own topics"
  on public.topics for select
  using (auth.uid() = user_id);

create policy "Users can insert their own topics"
  on public.topics for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own topics"
  on public.topics for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own topics"
  on public.topics for delete
  using (auth.uid() = user_id);

-- Seed a starter set of topics for every new user, alongside their profile.
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
  on conflict (user_id, name) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_topics
  after insert on auth.users
  for each row
  execute function public.handle_new_user_topics();

-- ── session_topics ──────────────────────────────────────────────────────
-- A session can touch more than one topic (e.g. "JoaSuite에서 Liflux 업무
-- 관리" — both Liflux and JoaSuite). `confidence` is for when AI
-- classification assigns topics automatically; it's null for anything
-- linked by hand.
create table public.session_topics (
  session_id uuid not null references public.sessions (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  primary key (session_id, topic_id)
);

create index session_topics_topic_id_idx on public.session_topics (topic_id);

alter table public.session_topics enable row level security;

-- No user_id column here on purpose -- ownership is proven by requiring
-- BOTH the session and the topic to belong to the caller, so a session
-- can never be tagged with someone else's topic (or vice versa).
create policy "Users can view links for their own sessions and topics"
  on public.session_topics for select
  using (
    exists (select 1 from public.sessions s where s.id = session_topics.session_id and s.user_id = auth.uid())
    and exists (select 1 from public.topics t where t.id = session_topics.topic_id and t.user_id = auth.uid())
  );

create policy "Users can link their own sessions to their own topics"
  on public.session_topics for insert
  with check (
    exists (select 1 from public.sessions s where s.id = session_topics.session_id and s.user_id = auth.uid())
    and exists (select 1 from public.topics t where t.id = session_topics.topic_id and t.user_id = auth.uid())
  );

create policy "Users can unlink their own sessions and topics"
  on public.session_topics for delete
  using (
    exists (select 1 from public.sessions s where s.id = session_topics.session_id and s.user_id = auth.uid())
    and exists (select 1 from public.topics t where t.id = session_topics.topic_id and t.user_id = auth.uid())
  );
