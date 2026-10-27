-- Khet Saathi v0.11.0: poultry sheds as their own places, and the place check saved on each land.
-- Run once in the Supabase SQL Editor. Safe to run again.
-- The shed sensor kit, shops, calls and money stay simulated.

-- 1. Sheds: the farmer switches between fields (lands) and sheds in the app header.
create table if not exists public.sheds (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 60),
  chickens    integer check (chickens is null or (chickens > 0 and chickens <= 100000)),
  lat         double precision,
  lon         double precision,
  lang        text not null default 'bn' check (lang in ('bn', 'hi', 'en')),
  demo        boolean not null default false   -- the demo shed keeps its scripted demo calls; a real shed never fakes a call
);
alter table public.sheds add column if not exists demo boolean not null default false;
alter table public.sheds enable row level security;
-- No policies on purpose: browsers never talk to the database directly.

-- The shed the app has used since v0.7 (its clips, kit and egg sales), so it shows up in the switcher.
insert into public.sheds (name, chickens, lat, lon, lang, demo)
select 'ডেমো শেড', 300, 23.64, 87.73, 'bn', true
where not exists (select 1 from public.sheds);

-- 2. Where each land is and what covers it (OpenStreetMap + ESA WorldCover), checked once and reused.
alter table public.lands add column if not exists place_info jsonb;

-- Verify (read-only): sheds rls_on = true, at least 1 shed, place_info column present
select tablename, rowsecurity as rls_on from pg_tables where schemaname = 'public' and tablename = 'sheds';
select count(*) as sheds from public.sheds;
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'lands' and column_name = 'place_info';
