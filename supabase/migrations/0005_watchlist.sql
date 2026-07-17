-- Phase 6 schema: user watchlists + the alerts a scheduled job writes when a condition fires.
-- Run this in the Supabase SQL editor after 0004_profile_address.sql.

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  condition text not null check (
    condition in ('price_drop_5pct', 'price_rise_5pct', 'bullish_pattern', 'bearish_pattern')
  ),
  created_at timestamptz not null default now()
);

-- One row per (user, symbol, condition) — re-adding the same watch is a no-op, not a duplicate.
create unique index if not exists watchlist_user_symbol_condition_idx
  on public.watchlist (user_id, symbol, condition);

alter table public.watchlist enable row level security;

-- drop-then-create makes this file safely re-runnable (unlike `create table if not exists`,
-- `create policy` has no `if not exists` form).
drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own" on public.watchlist
  for select using (auth.uid() = user_id);

drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own" on public.watchlist
  for insert with check (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own" on public.watchlist
  for delete using (auth.uid() = user_id);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlist (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  condition text not null,
  message text not null,
  triggered_at timestamptz not null default now()
);

create index if not exists alerts_watchlist_id_triggered_at_idx
  on public.alerts (watchlist_id, triggered_at);

alter table public.alerts enable row level security;

-- Same payment-integrity-style boundary as `subscriptions` (guardrail 6.9's pattern applied to
-- alerts): users may read their own alerts, but there is deliberately no insert/update/delete
-- policy for authenticated/anon roles — only the cron endpoint (service-role key, bypasses RLS)
-- may write here. A client must never be able to fabricate its own triggered alert.
drop policy if exists "alerts_select_own" on public.alerts;
create policy "alerts_select_own" on public.alerts
  for select using (auth.uid() = user_id);
