-- Attachments (audio/image/document metadata) and the Storage bucket their
-- files actually live in. Nothing in this phase uploads a real file yet --
-- this is the foundation the recording phase builds on.
--
-- Storage path convention: recordings/{user_id}/{session_id}/<file_name>

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  type text not null check (type in ('audio', 'image', 'document')),
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create index attachments_session_id_idx on public.attachments (session_id);
create index attachments_user_id_idx on public.attachments (user_id);

alter table public.attachments enable row level security;

create policy "Users can view attachments on their own sessions"
  on public.attachments for select
  using (
    auth.uid() = user_id
    and exists (select 1 from public.sessions s where s.id = attachments.session_id and s.user_id = auth.uid())
  );

create policy "Users can insert attachments on their own sessions"
  on public.attachments for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.sessions s where s.id = attachments.session_id and s.user_id = auth.uid())
  );

create policy "Users can delete attachments on their own sessions"
  on public.attachments for delete
  using (
    auth.uid() = user_id
    and exists (select 1 from public.sessions s where s.id = attachments.session_id and s.user_id = auth.uid())
  );

-- ── Storage bucket ──────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- Every object's path starts with the owning user's id
-- (recordings/{user_id}/{session_id}/...), so folder-name matching against
-- auth.uid() is enough to scope access without a separate metadata table.
create policy "Users can view their own recordings"
  on storage.objects for select
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload their own recordings"
  on storage.objects for insert
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own recordings"
  on storage.objects for update
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own recordings"
  on storage.objects for delete
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);
