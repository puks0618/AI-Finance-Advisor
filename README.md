# AI Finance Advisor

A web app with two modes: a consultative **finance advisor chat** that asks about your income,
expenses, debt, and goals before giving guidance, and a **stock research assistant** that combines
live market data, deterministic candlestick-pattern detection, and news into a plain-English brief
tailored to your risk profile. Its signature feature is a **proactive AI phone call** — the AI can
call you (or you can call it) and talk through what's on your watchlist.

Everything is framed as research and education, never as a "buy" or "sell" instruction — see
[Guardrails](#guardrails) below.

## Stack

- **Next.js (App Router)** — UI + API routes, deployed as Vercel serverless functions.
- **Gemini** (primary) / **Claude** (fallback) — the single AI brain behind chat, stock briefs, and
  phone calls. One provider fails over to the other on error; see `lib/gemini.ts` / `lib/claude.ts`.
- **Finnhub** + **Yahoo candles** — quotes, OHLC candles, company news, and sentiment.
- **Supabase** — Postgres + auth. Every table has Row-Level Security scoped to `auth.uid()`.
- **Stripe** (test mode) — subscription checkout and webhook-driven feature gating.
- **Web Speech API** — in-browser voice chat (progressive enhancement, no server cost).
- **Vapi** — outbound/inbound AI phone calls: phone-number verification and the proactive advisor
  call, both server-gated and rate-limited.
- **Vercel Cron** — periodic watchlist checks (`vercel.json`).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the keys below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run the Supabase migrations in `supabase/migrations/` in order (SQL editor or CLI) against your
own Supabase project before using auth-backed features.

```bash
npm run test    # vitest — pattern engine, guardrails, watchlist logic
npm run lint
npm run build
```

## Environment variables

All of these live in `.env.local` (never committed) and are mirrored, blank, in `.env.example`.
Nothing without a `NEXT_PUBLIC_` prefix is ever readable from the client.

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | Primary LLM (chat, stock briefs, phone assistant) |
| `ANTHROPIC_API_KEY` | Fallback LLM if Gemini errors/rate-limits |
| `FINNHUB_API_KEY` | Quotes, news, sentiment |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase client config |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only, bypasses RLS — used by webhooks/cron only |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRO_PRICE_ID` | Checkout + billing webhook |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe.js on the client |
| `NEXT_PUBLIC_APP_URL` | Checkout success/cancel redirect base URL |
| `CRON_SECRET` | Required bearer token on `/api/cron/check-watchlists` |
| `VAPI_API_KEY` / `VAPI_PUBLIC_KEY` / `VAPI_PHONE_NUMBER_ID` / `VAPI_ASSISTANT_ID` | Vapi call placement |
| `VAPI_LLM_PROXY_SECRET` | Authenticates Vapi's requests into `/api/vapi-llm` |
| `VAPI_WEBHOOK_SECRET` | Authenticates Vapi's call-status callbacks to `/api/vapi-webhook` |

The Vapi Assistant itself (`VAPI_ASSISTANT_ID`) is created once, out-of-band, in the Vapi
dashboard or API, pointed at your deployed `/api/vapi-llm` proxy URL — it can't exist until that
route has a public URL (e.g. via a Vercel deploy or an `ngrok` tunnel in local dev).

## Architecture

```
app/
  page.tsx, login/, pricing/, profile/     marketing + auth + billing + profile UI
  chat/page.tsx                            both modes (advisor / stock / watchlist), mode-toggled
  api/
    chat/                                  Mode 1 — finance advisor chat (Gemini + guardrails)
    stock/                                 Mode 2 — quote + candles + patterns + news → AI brief
    checkout/, stripe-webhook/, subscription/   Stripe test-mode billing
    watchlist/, cron/check-watchlists/     watchlist CRUD + scheduled condition checks → alerts
    calls/, phone/, vapi-webhook/, vapi-llm/    proactive AI phone calls (Vapi)
lib/
  gemini.ts, claude.ts        AI provider wrapper + fallback, single MODEL_NAME constant
  patterns.ts                 deterministic candlestick pattern engine (unit-tested)
  guardrails.ts                validation, PII redaction, distress detection, advice-phrase check
  finnhub.ts, yahoo-candles.ts, cache.ts, fetch-with-retry.ts   market data + resilience
  supabase/                   browser / server / admin Supabase clients
  subscription.ts, watchlist.ts, vapi.ts, useSpeech.ts
supabase/migrations/           numbered, idempotent SQL migrations (RLS on every table)
proxy.ts                       Next.js 16's replacement for middleware.ts — refreshes auth sessions
```

State that must persist between requests (profile, conversation history, watchlist, alerts, call
attempts, subscription status) lives in Supabase. Everything else is stateless and serverless.

## Guardrails

This is a finance product touching people's money, personal data, and a phone line, so guardrails
are core functionality, not polish (`lib/guardrails.ts`, enforced in every AI system instruction):

- Never a direct "buy/sell" instruction — always framed as research, with reasoning and uncertainty.
- User input, headlines, and any external text are treated as untrusted data, never as instructions.
- Tickers and messages are validated and length-capped before touching a prompt or an API URL.
- External calls (Gemini, Claude, Finnhub) back off and retry on 429, then fail with a clean message.
- Signs of financial/emotional distress get an extra-care response, not encouragement of risky bets.
- PII (account numbers, SSNs, etc.) is never echoed back or persisted.
- Row-Level Security on every table; no route trusts a client-supplied user ID.
- Subscription status is checked server-side on every gated route; Stripe webhook signatures are verified.
- Phone calls are Pro-gated, rate-limited per user per day, and the cron/webhook endpoints require a shared secret.

## What's not built / future roadmap

- Automatic outbound calls when a watchlist alert fires — calls are currently user-initiated
  (a "call me" / "discuss this" button) rather than fired straight from the cron job, to keep
  telephony cost and unsolicited-call risk bounded. Revisiting this would mean adding an opt-in
  auto-call toggle per watchlist item, still behind the same daily rate limit.
- A real-estate / mortgage research module (out of scope for the current build).
- Production-scale telephony — the current Vapi setup targets demo volume on trial credit, not a
  24/7 production call center.
- **Intraday watchlist checks.** `vercel.json`'s cron schedule runs `/api/cron/check-watchlists`
  once daily (14:00 UTC), not continuously through market hours — Vercel Cron on the Hobby (free)
  plan is limited to once-per-day invocations. This means a condition like "TSLA drops 5%" is only
  evaluated once every 24 hours, so most intraday moves aren't caught until the next day's run.
  Upgrading to Vercel Pro removes this cap; at that point change the schedule to something like
  `*/15 13-20 * * 1-5` (every 15 minutes, US market hours, weekdays) to restore the original
  intraday-monitoring intent.
