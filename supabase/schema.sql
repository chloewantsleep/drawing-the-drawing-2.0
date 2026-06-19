-- dtd2 — Supabase schema for saving generated floor plans per user.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- Auth: enable an email or OAuth provider under Authentication → Providers, and
-- add your site URLs (http://localhost:5178 and your Vercel domain) under
-- Authentication → URL Configuration → Redirect URLs.

create table if not exists drawings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  scene_key   text,
  data        jsonb not null,            -- serialized drawing (shapes, regions, door overrides, …)
  updated_at  timestamptz not null default now()
);

-- Each user can only see and modify their own rows.
alter table drawings enable row level security;

drop policy if exists "own drawings" on drawings;
create policy "own drawings" on drawings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Fast "my drawings, newest first" listing.
create index if not exists drawings_user_updated_idx
  on drawings (user_id, updated_at desc);
