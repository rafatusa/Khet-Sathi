-- Khet Saathi v0.8.0: the farmer's sell rule for eggs (when to sell, lowest price, which shops).
-- Run once in the Supabase SQL Editor. Safe to run again.
-- Shops, calls and money are simulated; a confirmed sale is stored in the existing public.deals table.

create table if not exists public.sell_rules (
  kind          text primary key check (kind in ('eggs', 'crop')),
  enabled       boolean not null default true,
  min_count     integer check (min_count is null or min_count > 0),     -- sell when this many eggs are in stock
  every_days    integer check (every_days is null or every_days > 0),   -- or every N days, whichever comes first
  floor_price   numeric(10, 2) not null check (floor_price > 0),        -- lowest price per tray (INR); Saathi never goes below
  shop_ids      jsonb not null default '[]'::jsonb,                     -- contacts to call; empty = all egg shops
  ask_first     boolean not null default true,                          -- ask the farmer before calling
  started_at    timestamptz,
  last_sold_at  timestamptz,
  last_run      jsonb,                                                  -- the latest round of calls and offers
  updated_at    timestamptz not null default now()
);

alter table public.sell_rules enable row level security;
-- No policies on purpose: browsers never talk to the database directly.

-- Verify (read-only): one row, rls_on = true
select tablename, rowsecurity as rls_on from pg_tables where schemaname = 'public' and tablename = 'sell_rules';
