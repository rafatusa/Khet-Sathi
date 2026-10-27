-- Khet Saathi v0.3.0 — core tables, photo storage bucket, simulated contacts
-- Run in Supabase: SQL Editor → New query → paste all → Run.
-- Safe to run more than once (idempotent).

-- ============ 1. Lands (each plot a farmer adds) ============
create table if not exists public.lands (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  kind             text not null check (kind in ('empty', 'crop')),
  name             text,
  crop             text,
  lang             text not null default 'bn' check (lang in ('bn', 'hi', 'en')),
  lat              double precision not null,
  lon              double precision not null,
  location_source  text not null default 'gps' check (location_source in ('gps', 'demo')),
  place            text,
  acres            numeric(10, 2),
  selected_object  text,
  objects          jsonb not null default '[]'::jsonb,
  ground_m         numeric(10, 2),
  image_px         integer,
  tile_path        text,
  photo_path       text
);
create index if not exists lands_created_at_idx on public.lands (created_at desc);

-- ============ 2. Alerts (agent speaks up on its own; filled from v0.4) ============
create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  land_id     uuid references public.lands (id) on delete cascade,
  area        text not null default 'field' check (area in ('field', 'shed', 'market', 'weather')),
  severity    text not null default 'info' check (severity in ('info', 'warn', 'urgent')),
  title       text not null,
  body        text,
  source      text,
  read        boolean not null default false
);
create index if not exists alerts_unread_idx on public.alerts (read, created_at desc);

-- ============ 3. Contacts (simulated vendors, buyers, shops, vet, crews) ============
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  role        text not null check (role in ('vendor', 'buyer', 'shop', 'vet', 'harvester', 'transport', 'tractor')),
  name        text not null,
  phone       text,
  village     text,
  details     jsonb not null default '{}'::jsonb,
  simulated   boolean not null default true
);
create unique index if not exists contacts_role_name_uidx on public.contacts (role, name);

-- ============ 4. Deals (draft orders and sales; confirmed only by the farmer) ============
create table if not exists public.deals (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  land_id     uuid references public.lands (id) on delete set null,
  contact_id  uuid references public.contacts (id) on delete set null,
  direction   text not null check (direction in ('buy', 'sell')),
  items       jsonb not null default '[]'::jsonb,
  total_inr   numeric(12, 2),
  status      text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled'))
);

-- ============ 5. Sensor readings (simulated kit stream; filled from v0.4) ============
create table if not exists public.sensor_readings (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  device  text not null,
  area    text not null check (area in ('field', 'shed')),
  metric  text not null,
  value   double precision not null
);
create index if not exists sensor_readings_lookup_idx on public.sensor_readings (device, metric, at desc);

-- ============ 6. Lock tables: only the server (secret key) may read/write ============
alter table public.lands           enable row level security;
alter table public.alerts          enable row level security;
alter table public.contacts        enable row level security;
alter table public.deals           enable row level security;
alter table public.sensor_readings enable row level security;
-- No policies on purpose: browsers never talk to the database directly.

-- ============ 7. Private bucket for farm photos and satellite tiles ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('land-images', 'land-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ============ 8. Simulated contact network (clearly marked simulated) ============
insert into public.contacts (role, name, phone, village, details, simulated) values
  ('vendor',    'মা লক্ষ্মী কৃষি কেন্দ্র',  '+91 90000 00101', 'বোলপুর',     '{"sells": ["seed", "fertilizer"], "distance_km": 3}', true),
  ('vendor',    'বোলপুর কৃষক সমবায়',        '+91 90000 00102', 'বোলপুর',     '{"sells": ["fertilizer"], "distance_km": 5}', true),
  ('vendor',    'সবুজ বীজ ভাণ্ডার',         '+91 90000 00103', 'ইলামবাজার',  '{"sells": ["seed"], "distance_km": 11}', true),
  ('tractor',   'বিশু দাসের ট্রাক্টর',        '+91 90000 00201', 'বোলপুর',     '{"rate_inr_per_acre": 700}', true),
  ('harvester', 'রায় হারভেস্টার সার্ভিস',      '+91 90000 00301', 'সিউড়ি',      '{"rate_inr_per_acre": 2400}', true),
  ('transport', 'মাঠ থেকে মিল ট্রান্সপোর্ট',   '+91 90000 00401', 'বোলপুর',     '{"rate_inr_per_trip": 1800}', true),
  ('buyer',     'অন্নপূর্ণা রাইস মিল',        '+91 90000 00501', 'বর্ধমান',     '{"buys": ["paddy"], "price_inr_per_quintal": 2350}', true),
  ('buyer',     'বোলপুর কৃষি মান্ডি',         '+91 90000 00502', 'বোলপুর',     '{"buys": ["paddy", "mustard", "potato"], "price_inr_per_quintal": 2200}', true),
  ('shop',      'রহমান স্টোর',               '+91 90000 00601', 'বোলপুর',     '{"buys": ["eggs"], "last_price_inr_per_tray": 180, "usual_trays": 10}', true),
  ('shop',      'নিউ মা তারা ভ্যারাইটি',      '+91 90000 00602', 'বোলপুর',     '{"buys": ["eggs"], "last_price_inr_per_tray": 176, "usual_trays": 6}', true),
  ('shop',      'হোটেল সোনার বাংলা',          '+91 90000 00603', 'শান্তিনিকেতন', '{"buys": ["eggs"], "last_price_inr_per_tray": 188, "usual_trays": 15}', true),
  ('vet',       'ডা. অমিত সেন (পশু চিকিৎসক)',  '+91 90000 00701', 'বোলপুর',     '{"visits": true}', true)
on conflict (role, name) do nothing;

-- ============ Verification (read-only) ============
-- A. All five tables exist and have row level security on
select tablename, rowsecurity as rls_on
from pg_tables
where schemaname = 'public'
  and tablename in ('lands', 'alerts', 'contacts', 'deals', 'sensor_readings')
order by tablename;

-- B. Photo bucket exists and is private
select id, public from storage.buckets where id = 'land-images';

-- C. Simulated contacts by role (expect 12 total)
select role, count(*) as contacts from public.contacts group by role order by role;
