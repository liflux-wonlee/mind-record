-- Profiles + shared helpers.
--
-- `public.set_updated_at()` is reused by every later migration that has an
-- `updated_at` column. `public.handle_new_user()` keeps `profiles` in sync
-- with `auth.users` automatically: every new Supabase Auth user gets a
-- profile row the instant they sign up, so the app never has to remember to
-- create one itself.

-- ── shared trigger: keep updated_at current ────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── profiles ────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  -- basic per-user preferences the Account screen already has UI for
  timezone text not null default 'UTC',
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per authenticated user, keyed to auth.users. Created automatically '
  'by the on_auth_user_created trigger below.';

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Not normally needed (the trigger below inserts via SECURITY DEFINER, which
-- bypasses RLS), but kept as a safety net for any future path that inserts a
-- profile directly from the client.
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ── auto-create a profile row for every new auth user ─────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
