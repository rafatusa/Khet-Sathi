-- Khet Sathi v0.15.0: home yards (the open space in front of the house).
-- Run once in Supabase -> SQL Editor. Safe to run again.
create table if not exists public.yards (
  id            uuid primary key,
  created_at    timestamptz not null default now(),
  owner_id      uuid,
  demo          boolean not null default false,
  lat           double precision not null,
  lon           double precision not null,
  lang          text not null default 'bn',
  place_info    jsonb,
  photo_path    text,
  outline       jsonb,
  sam           jsonb,
  size          jsonb,
  size_m2       double precision,
  sun           text check (sun in ('full', 'half', 'shade'))
);
create index if not exists yards_owner on public.yards (owner_id);
-- Only the server (secret key) reads and writes; nobody else.
alter table public.yards enable row level security;
