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


-- ============================================================================
-- Sharing.
--
-- Nothing here is visible to anyone else until its owner deliberately opts in
-- by publishing. The write policy above stays owner-only, so "view mode" is
-- enforced by the database, not by hiding buttons: a visitor physically cannot
-- change another person's tree, whatever the client does.
-- ============================================================================

create table if not exists public.profiles (
  owner        uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  published    boolean not null default false,
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "owners manage their own profile" on public.profiles;
create policy "owners manage their own profile"
  on public.profiles
  for all
  to authenticated
  using (auth.uid() = owner)
  with check (auth.uid() = owner);

-- A published profile is the only thing a stranger, or a signed-out guest,
-- is ever shown.
drop policy if exists "published profiles are readable" on public.profiles;
create policy "published profiles are readable"
  on public.profiles
  for select
  to anon, authenticated
  using (published);

-- Trees follow the profile: readable by others only while it is published.
-- Postgres ORs permissive policies, so owners keep full access to their own.
drop policy if exists "published trees are readable" on public.trees;
create policy "published trees are readable"
  on public.trees
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.owner = trees.owner
        and p.published
    )
  );
