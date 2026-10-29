-- Khet Sathi v0.22.0: Sathi on watch (her missions and each farm's setting).
-- Run once in Supabase -> SQL Editor. Safe to run again.
create table if not exists public.watch_missions (
  id          uuid primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  owner_id    uuid,
  place_kind  text not null check (place_kind in ('field', 'shed', 'yard')),
  place_id    uuid,
  trigger     text not null,
  facts       jsonb,
  mode        text not null default 'ask' check (mode in ('tell', 'ask', 'rules')),
  status      text not null default 'running' check (status in ('running', 'sleeping', 'waiting', 'done', 'failed')),
  runs        integer not null default 0,
  due_at      timestamptz,
  model       text,
  steps       jsonb not null default '[]'::jsonb,
  messages    jsonb not null default '[]'::jsonb
);
create index if not exists watch_missions_owner on public.watch_missions (owner_id, created_at desc);
create index if not exists watch_missions_due on public.watch_missions (status, due_at);

-- One row per farm (owner_key is the farm's user id, or 'demo' for the demo farm).
create table if not exists public.watch_settings (
  owner_key   text primary key,
  mode        text not null default 'ask' check (mode in ('tell', 'ask', 'rules')),
  updated_at  timestamptz not null default now()
);

-- Only the server (secret key) reads and writes; nobody else.
alter table public.watch_missions enable row level security;
alter table public.watch_settings enable row level security;
