-- Khet Saathi v0.4.0: soil saved per land, and the FAO farming zone used for its crop calendar.
-- Safe to run more than once. Run in the Supabase SQL Editor.

alter table public.lands add column if not exists soil jsonb;
alter table public.lands add column if not exists aez text;

comment on column public.lands.soil is 'SoilGrids summary for this land (texture, pH, organic carbon), saved once when first looked up';
comment on column public.lands.aez is 'FAO crop calendar zone used for this land, e.g. 4. Karatoya-Bangali Floodplain';

-- Verify (read-only): both rows should come back.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'lands' and column_name in ('soil', 'aez');
