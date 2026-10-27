-- Khet Sathi v0.13.0: sign-in by email code. Every farm's rows carry its owner (a Supabase Auth user).
-- Rows with no owner: the shared demo lands (copied into each new farm), the demo shed and its alerts.
-- Safe to run more than once.

alter table lands  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table sheds  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table deals  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table alerts add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create index if not exists lands_owner_idx  on lands (owner_id, created_at desc);
create index if not exists sheds_owner_idx  on sheds (owner_id);
create index if not exists deals_owner_idx  on deals (owner_id, created_at desc);
create index if not exists alerts_owner_idx on alerts (owner_id, created_at desc);

-- Sell rules: one per farm and kind (was one per kind for everyone).
alter table sell_rules add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table sell_rules drop constraint if exists sell_rules_pkey;
create unique index if not exists sell_rules_owner_kind on sell_rules (owner_id, kind);

-- Test rows from before sign-in are hidden from every farm; their alerts are marked read.
update alerts set read = true where owner_id is null and land_id is not null;
