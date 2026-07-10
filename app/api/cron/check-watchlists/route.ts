import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuote, type Quote } from "@/lib/finnhub";
import { getDailyCandles } from "@/lib/yahoo-candles";
import { detectPatterns, type DetectedPattern } from "@/lib/patterns";
import { evaluateCondition, describeTrigger, isAlertCondition, type AlertCondition } from "@/lib/watchlist";

// Vercel's default serverless timeout (10s on Hobby) can be too tight once this loops market-data
// fetches (with 429 backoff) across every distinct watched symbol in one run. 60s is the
// Hobby-tier ceiling.
export const maxDuration = 60;

interface WatchlistRow {
  id: string;
  user_id: string;
  symbol: string;
  condition: string;
}

// 6.11 — Vercel sends this header automatically on every Cron invocation when CRON_SECRET is set
// as a project env var. Fail closed (reject) if the secret isn't configured at all, rather than
// accidentally leaving the endpoint open.
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase.from("watchlist").select("id, user_id, symbol, condition");
  if (error) {
    console.error("check-watchlists: failed to load watchlist rows:", error);
    return NextResponse.json({ error: "Failed to load watchlist." }, { status: 500 });
  }

  const watchlistRows = (rows ?? []) as WatchlistRow[];
  const symbols = Array.from(new Set(watchlistRows.map((r) => r.symbol)));

  // Dedupe market-data fetches by symbol — several users can watch the same ticker, and this is
  // a shared free-tier API budget (6.4). getQuote/getDailyCandles already cache for 60s, but this
  // avoids even issuing the redundant calls within a single run.
  const marketData = new Map<string, { quote: Quote | null; patterns: DetectedPattern[] }>();
  for (const symbol of symbols) {
    try {
      const [quote, candles] = await Promise.all([getQuote(symbol), getDailyCandles(symbol)]);
      marketData.set(symbol, { quote, patterns: detectPatterns(candles) });
    } catch (err) {
      console.error(`check-watchlists: market data fetch failed for ${symbol}:`, err);
      marketData.set(symbol, { quote: null, patterns: [] });
    }
  }

  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  let triggered = 0;
  for (const row of watchlistRows) {
    if (!isAlertCondition(row.condition)) continue; // defensive — the DB check constraint already guarantees this
    const data = marketData.get(row.symbol);
    if (!data) continue;

    const fired = evaluateCondition(row.condition as AlertCondition, data.quote, data.patterns);
    if (!fired) continue;

    // Idempotent: skip if this watchlist item already produced an alert today — running the job
    // twice, or the condition staying true across many runs, must never spam duplicates (6.11).
    const { count } = await supabase
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("watchlist_id", row.id)
      .gte("triggered_at", startOfToday.toISOString());
    if ((count ?? 0) > 0) continue;

    const message = describeTrigger(row.condition as AlertCondition, row.symbol, data.quote, data.patterns);
    const { error: insertError } = await supabase.from("alerts").insert({
      watchlist_id: row.id,
      user_id: row.user_id,
      symbol: row.symbol,
      condition: row.condition,
      message,
    });
    if (insertError) {
      console.error(`check-watchlists: failed to insert alert for watchlist ${row.id}:`, insertError);
      continue;
    }
    triggered++;
  }

  return NextResponse.json({ checked: watchlistRows.length, triggered });
}
