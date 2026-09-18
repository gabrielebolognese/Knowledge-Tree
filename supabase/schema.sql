-- knowledge tree — run this once in the Supabase SQL editor.
-- Safe to re-run: every statement is idempotent.

-- One row per user. The whole workspace (all eight trees) is a single JSON
-- document, which stays small: a paragraph-heavy node is about 400 bytes.
create table if not exists public.trees (
  owner      uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.trees enable row level security;

-- Your row is yours. This is what makes publishing the anon key safe.
drop policy if exists "trees are private to their owner" on public.trees;
create policy "trees are private to their owner"
  on public.trees
  for all
  to authenticated
  using (auth.uid() = owner)
  with check (auth.uid() = owner);


-- Images live in storage, not in the document, so the JSON stays light.
-- The bucket is public-read on purpose: signed URLs expire, and an expired URL
-- saved inside a node would turn into a broken image later. Paths are random
-- UUIDs under a per-user folder, so they are unguessable but not secret.
insert into storage.buckets (id, name, public)
values ('tree-images', 'tree-images', true)
on conflict (id) do update set public = true;

drop policy if exists "owners upload their own images" on storage.objects;
create policy "owners upload their own images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'tree-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "owners delete their own images" on storage.objects;
create policy "owners delete their own images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'tree-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "tree images are readable" on storage.objects;
create policy "tree images are readable"
  on storage.objects
  for select
  to public
  using (bucket_id = 'tree-images');
