# Pre-Deployment Remediation Plan — AI Finance Advisor

## Context

A senior pre-deployment audit of this Next.js 16 + Supabase + Stripe + Vapi finance app
found the core product solid (build/lint/64 tests green, every §6 guardrail actually
implemented) but surfaced **6 gaps** — 3 that will bite in production and 3 UX/resilience
issues. This document is the phased remediation plan to close them before the app goes live
on **Vercel Hobby (free tier)**.

**Deliverable of this task:** this markdown plan (alongside `IMPLEMENTATION_PLAN.md`).
**No code is changed in this document** — implementation happens in a follow-up once this
plan is approved.

**Key constraints from the deployment target (Hobby tier):**
- Serverless functions: default 10s timeout, **configurable up to 60s** (not 300s).
- Vercel Cron on Hobby is limited to **once per day** — more frequent scheduling requires Pro.
- `$0` ongoing cost must be preserved (matches the project's founding constraint).

---

## Phase 1 — Critical deploy blockers (do first)

### 1.1 Add `maxDuration` to slow API routes (Gap #1)
**Problem:** No route declares `maxDuration`, so every function inherits Hobby's 10s default.
`POST /api/stock` chains parallel Finnhub+Yahoo fetches (each up to 3× 429-backoff ≈ 7s) →
a `ThinkingLevel.HIGH` Gemini call (deliberately slow) → a Claude fallback. This passes
locally (no cap) and will intermittently **504 in production**.

**Fix:** Add the Next 16 route-segment config `export const maxDuration = 60;` (verified valid
against the bundled docs at `node_modules/next/dist/docs/.../route-segment-config/maxDuration.md`)
to the heavy routes:
- `app/api/stock/route.ts` — the worst offender (data fetch + HIGH-thinking LLM + fallback).
- `app/api/chat/route.ts` — chat reply + a second `extractProfile` Gemini call + fallback.
- `app/api/cron/check-watchlists/route.ts` — loops all watchlist rows fetching market data serially.

Optionally add `maxDuration = 30` to the Vapi-calling routes (`app/api/calls/route.ts`,
`app/api/phone/send-code/route.ts`) which make blocking external HTTP calls.

**Note / dependency:** 60s is the Hobby ceiling. If real-world timeouts persist even at 60s,
the secondary lever is lowering the stock route's `ThinkingLevel.HIGH` (`app/api/stock/route.ts:384`)
to `MEDIUM` — call that out but don't do it pre-emptively.

### 1.2 Fix the no-op `watchlist.condition` CHECK constraint (Gap #2)
**Problem:** `0001_init.sql` creates `public.watchlist` **without** a `condition` check.
`0005_watchlist.sql` re-declares the table with `create table if not exists (... check (...))`,
but because the table already exists, that statement is a **no-op** — the CHECK never lands.
(The `create unique index if not exists` and the `drop/create policy` statements in 0005 *are*
separate statements, so those *do* land; only the embedded constraint is lost.)
`app/api/cron/check-watchlists/route.ts:58` comments *"the DB check constraint already
guarantees this"* — **false as shipped.**

**Fix:** Add a new **forward-only** migration (do NOT edit 0005 — it may already have run on the
live project) `supabase/migrations/0007_watchlist_condition_check.sql`, idempotent:
```sql
alter table public.watchlist drop constraint if exists watchlist_condition_check;
alter table public.watchlist
  add constraint watchlist_condition_check
  check (condition in ('price_drop_5pct','price_rise_5pct','bullish_pattern','bearish_pattern'));
```
Existing rows are safe (the app layer already allowlists via `isAlertCondition` in
`lib/watchlist.ts:21`). Keep the app-layer check as defense-in-depth; the comment at
`check-watchlists/route.ts:58` becomes true once this lands.

### 1.3 Make the once-daily cron an explicit, documented limitation (Gap #3)
**Problem:** `vercel.json` schedules `"0 14 * * *"` (once/day), not the plan's "every 15 min
during market hours." On the chosen **Hobby tier this is a hard platform cap**, so the schedule
stays — but right now users get no signal that "call me if TSLA drops 5%" is only evaluated
once every 24h.

**Fix (no schedule change — document it instead):**
- README "What's not built / future roadmap": state watchlist conditions are checked **once
  daily at 14:00 UTC** on the free tier, and that upgrading to Vercel Pro + editing the
  `vercel.json` schedule (e.g. `*/15 13-20 * * 1-5`) enables intraday checks.
- Add a one-line note in the watchlist UI panel (`app/chat/page.tsx`, `WatchlistPanel`) — e.g.
  "Conditions are checked once a day." — so expectations are set in-product, not just docs.

---

## Phase 2 — Resilience: real fallback candle source (Gap #4)

> **Implementation note (as executed):** the provider originally named below, Stooq, was verified
> live during implementation and found to be non-functional — as of 2026-07 its CSV download
> endpoint gates every request (with or without a browser User-Agent, on both `stooq.com` and
> `stooq.pl`) behind a client-side JS proof-of-work challenge a server-side `fetch` can never
> solve. Shipping it would have been dead code disguised as resilience. **Nasdaq's public chart
> API** (`api.nasdaq.com/api/quote/{symbol}/chart`) was substituted instead — also free/keyless,
> verified working (AAPL/MSFT/TSLA, plus a clean `data: null` + HTTP 200 degrade for an invalid
> symbol) — with the same role: `lib/nasdaq-candles.ts` fallback behind `lib/candles.ts`. The
> rest of this section is left as originally planned for context; read "Stooq" below as "Nasdaq."

**Problem:** `lib/yahoo-candles.ts` scrapes an unofficial Yahoo endpoint (its own comment admits
it "could change without notice"). Unlike the Gemini→Claude LLM fallback, there is **no backup**
— if Yahoo blocks/changes, pattern detection (the "technical-analysis differentiator") silently
degrades to empty results.

**Fix — add a second free, keyless provider (Stooq) behind the same interface, mirroring the
`lib/gemini.ts:85-94` primary→fallback pattern:**

1. **New `lib/stooq-candles.ts`** — `getStooqDailyCandles(symbol, days): Promise<Candle[]>`.
   - Endpoint: `https://stooq.com/q/d/l/?s={symbol}.us&i=d` (daily OHLC CSV, **no API key** →
     preserves `$0` cost and matches the Yahoo "no-key" profile).
   - Parse CSV (`Date,Open,High,Low,Close,Volume`), return the same `Candle[]` shape as Yahoo,
     `.slice(-days)`.
   - **Reuse existing utilities:** `fetchWithRetry` (`lib/fetch-with-retry.ts`) and `cached`
     (`lib/cache.ts`) — same as `lib/yahoo-candles.ts` does.
   - Document the caveat: `.us` suffix means US symbols resolve; non-US tickers may not.

2. **New `lib/candles.ts` orchestrator** — `getDailyCandles(symbol, days)` tries Yahoo first;
   on empty/throw, falls back to Stooq; logs server-side when **both** fail (observability the
   audit flagged as missing). Rename the current function to `getYahooDailyCandles` and keep it
   internal to yahoo-candles.

3. **Update the two importers** — `app/api/stock/route.ts:5` and
   `app/api/cron/check-watchlists/route.ts:4` — to import `getDailyCandles` from the new
   orchestrator. The stock route already degrades gracefully on empty candles (guardrail 6.12),
   so no UI change is required beyond what already exists.

4. **Tests** — add `lib/stooq-candles.test.ts` (vitest, mirroring `lib/patterns.test.ts` style):
   a valid-CSV parse case and a malformed/empty-CSV case.

5. **README** — document both sources and that `lib/candles.ts` is the one place to touch if the
   data pipeline breaks.

---

## Phase 3 — UX polish

### 3.1 Mobile overflow on the primary app screen (Gap #5)
In `app/chat/page.tsx`:
- **ModeToggle (~L284):** the 3 mode buttons sit in a bare `flex gap-2` with no wrapping →
  overflow at ~375px. Add `flex-wrap` (matching the landing page pattern at `app/page.tsx:74,82`).
- **AuthHeader (~L973):** `justify-between gap-3` with a full un-truncated `user.email` can
  overflow. Add `flex-wrap` and `truncate` + a `max-w-*` on the email span.
- Verify at 375px width.

### 3.2 Surface mic-permission failures (Gap #6)
- `lib/useSpeech.ts:80`: `recognition.onerror = () => setListening(false)` swallows errors
  (e.g. mic denied) → the button looks broken. Add an `error` field to the hook's return, set a
  human message on `onerror` (distinguish `not-allowed`/`service-not-allowed` →
  "Microphone access was blocked — you can still type." from a generic message).
- Surface it in `app/chat/page.tsx` near the mic button using the existing error-render pattern.
- Verify by denying mic permission in Chrome.

### 3.3 Cheap hardening folded in from the audit (optional, same PR)
- News headline links (`app/chat/page.tsx:~721`) render raw upstream `n.url` in `<a href>` —
  add a one-line `http(s):`-scheme guard before rendering (defense-in-depth vs a malformed feed).
- Remove/guard the client-side `console.error` calls in `app/login/page.tsx:27,42` so internal
  error detail doesn't leak to the browser console in production.

---

## Phase 4 — Pre-deploy verification & release checklist

1. **Local gates:** `npm run build`, `npm run lint`, `npm run test` all green (test count grows
   by the new Stooq tests).
2. **Migrations:** run `0001`→`0007` in order on the Supabase project; confirm the constraint
   exists (`select conname from pg_constraint where conname = 'watchlist_condition_check';`).
3. **Env vars:** confirm all keys from `.env.example` are set in the Vercel project (Gemini,
   Anthropic, Finnhub, Supabase URL/anon/service-role, Stripe secret/webhook/price/publishable,
   `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, all `VAPI_*`).
4. **End-to-end smoke test** on the deployed URL: signup → profile → advisor chat → stock
   research (confirm candles render, then confirm Stooq path by temporarily breaking Yahoo) →
   watchlist add → manual `GET /api/cron/check-watchlists` with the `CRON_SECRET` bearer →
   phone verify → advisor call.
5. **Branch/release:** the working branch `fix/stock-analysis-and-call-gating` is **9 commits
   ahead of `origin/main`**. Confirm Vercel's production branch and **merge to `main`** (or point
   production at this branch) — otherwise none of these fixes, or the prior 9 commits, go live.

---

## Out of scope (note, don't fix now)
- `npm audit`: 1 moderate transitive advisory (postcss, nested under Next tooling) — build-time
  only, no non-breaking fix available; recheck after future Next upgrades.
- Loading skeletons for components that `return null` during initial auth check — cosmetic.
- Intraday cron (requires Vercel Pro) — deferred by the Hobby-tier decision; path documented in 1.3.

## Summary of files touched (when implemented)
- **New:** `supabase/migrations/0007_watchlist_condition_check.sql`, `lib/stooq-candles.ts`,
  `lib/candles.ts`, `lib/stooq-candles.test.ts`.
- **Edited:** `app/api/stock/route.ts`, `app/api/chat/route.ts`,
  `app/api/cron/check-watchlists/route.ts`, `lib/yahoo-candles.ts`, `app/chat/page.tsx`,
  `lib/useSpeech.ts`, `app/login/page.tsx`, `README.md`.
