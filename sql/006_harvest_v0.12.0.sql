-- Khet Saathi v0.12.0: a growing crop on a land (sowing date) and its harvest selling rule.
-- Safe to run more than once.
alter table lands add column if not exists sown_on date;
alter table lands add column if not exists sell_rule jsonb;
