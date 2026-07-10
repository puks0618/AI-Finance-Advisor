-- Fixes a migration bug: 0001_init.sql created public.watchlist without a check constraint on
-- `condition`, then 0005_watchlist.sql tried to add one via `create table if not exists (...
-- check (...))` — a no-op, since the table already existed by then. The constraint never
-- actually landed on a project that ran the migrations in documented order. This is a
-- forward-only fix (0005 is left untouched — it may already have run on a live project).
-- Run this in the Supabase SQL editor after 0006_calls.sql.

alter table public.watchlist drop constraint if exists watchlist_condition_check;

alter table public.watchlist
  add constraint watchlist_condition_check
  check (condition in ('price_drop_5pct', 'price_rise_5pct', 'bullish_pattern', 'bearish_pattern'));
