-- Phase 7 schema: a verified phone number per user, plus a log of every AI-agent call attempt.
-- Run this in the Supabase SQL editor after 0005_watchlist.sql.

alter table public.profiles add column if not exists phone_number text;
alter table public.profiles add column if not exists phone_verified boolean not null default false;

-- Short-lived state for the "Vapi calls you and reads back a code" verification flow (no Twilio
-- Verify/SMS involved — we reuse the same calling capability the app already needs for real
-- advisor calls). One row per user; a new verification request overwrites the previous one.
create table if not exists public.phone_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone_number text not null,
  code text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.phone_verifications enable row level security;

-- No select/insert/update policy for authenticated/anon at all — not even "select own" (unlike
-- call_attempts). The code must never be readable by any client query, and only our own
-- server-side route (service-role, since it also needs to write on behalf of unauthenticated-feeling
-- verification checks) generates/checks it. Tighter than the subscriptions/alerts pattern on purpose:
-- this table's whole purpose is a secret the row's own owner shouldn't be able to just SELECT.

create table if not exists public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  context text not null check (context in ('general', 'alert')),
  alert_id uuid references public.alerts (id) on delete set null,
  vapi_call_id text,
  status text not null default 'requested' check (status in ('requested', 'ringing', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists call_attempts_user_id_requested_at_idx
  on public.call_attempts (user_id, requested_at);

alter table public.call_attempts enable row level security;

-- drop-then-create makes this file safely re-runnable, same as 0005_watchlist.sql.
drop policy if exists "call_attempts_select_own" on public.call_attempts;
create policy "call_attempts_select_own" on public.call_attempts
  for select using (auth.uid() = user_id);

-- The call-request route inserts as the authenticated user themselves (guardrail 6.8), so this
-- policy is real, unlike alerts/subscriptions. But there is deliberately no update/delete policy
-- for authenticated/anon — only the Vapi webhook (service-role key) may update status/completed_at
-- once a call finishes, same payment-integrity-style boundary as `subscriptions` (6.9).
drop policy if exists "call_attempts_insert_own" on public.call_attempts;
create policy "call_attempts_insert_own" on public.call_attempts
  for insert with check (auth.uid() = user_id);
