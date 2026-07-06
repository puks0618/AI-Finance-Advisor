-- Phase 4 schema: Stripe subscription status + research-request tracking for the free-tier
-- daily cap. Run this in the Supabase SQL editor after 0001_init.sql.

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  status text not null default 'free' check (status in ('free', 'active', 'past_due', 'canceled')),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Users may read their own status but there is deliberately no insert/update/delete policy for
-- authenticated/anon roles: only the Stripe webhook (using the service-role key, which bypasses
-- RLS) may write here. This is the guardrail 6.9 payment-integrity boundary — a client must never
-- be able to grant itself Pro via a direct table write.
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

create table if not exists public.research_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  created_at timestamptz not null default now()
);

create index if not exists research_requests_user_id_created_at_idx
  on public.research_requests (user_id, created_at);

alter table public.research_requests enable row level security;

create policy "research_requests_select_own" on public.research_requests
  for select using (auth.uid() = user_id);

create policy "research_requests_insert_own" on public.research_requests
  for insert with check (auth.uid() = user_id);
