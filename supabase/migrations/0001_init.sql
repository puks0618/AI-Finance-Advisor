-- Phase 3 schema: profiles, conversations, watchlist. Run this in the Supabase SQL editor
-- (or via `supabase db push` if you're using the CLI). Every table is scoped to auth.uid()
-- via Row-Level Security so a user can only ever read/write their own rows (guardrail 6.8).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  income numeric,
  expenses numeric,
  debt numeric,
  risk_tolerance text check (risk_tolerance in ('conservative', 'moderate', 'aggressive')),
  goal text,
  preference text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_id_created_at_idx
  on public.conversations (user_id, created_at);

alter table public.conversations enable row level security;

create policy "conversations_select_own" on public.conversations
  for select using (auth.uid() = user_id);

create policy "conversations_insert_own" on public.conversations
  for insert with check (auth.uid() = user_id);

-- Not used until Phase 6, but created now per the plan so the schema ships in one migration.
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  condition text not null,
  created_at timestamptz not null default now()
);

alter table public.watchlist enable row level security;

create policy "watchlist_select_own" on public.watchlist
  for select using (auth.uid() = user_id);

create policy "watchlist_insert_own" on public.watchlist
  for insert with check (auth.uid() = user_id);

create policy "watchlist_delete_own" on public.watchlist
  for delete using (auth.uid() = user_id);
