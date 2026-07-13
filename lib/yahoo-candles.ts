import { fetchWithRetry } from "./fetch-with-retry";
import { cached } from "./cache";
import type { Candle } from "./patterns";

const CACHE_TTL_MS = 60_000;

// Finnhub's free tier no longer includes OHLC candles (confirmed 403 on /stock/candle as of
// 2026-07, regardless of symbol/params). This unofficial Yahoo Finance endpoint is the free
// substitute — no key required, verified working, but undocumented and could change without
// notice. lib/candles.ts is the primary→fallback orchestrator (this provider first, Stooq
// second) that callers should import from; this file is not meant to be imported directly
// outside of lib/candles.ts.
const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

interface YahooChartResponse {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
  };
}

// Widens the requested range only as far as needed — the default 30-day chart/pattern/MA
// callers stay on "3mo" (unchanged behavior), while the larger history lib/prediction.ts needs
// for model training lands on "6mo" or "1y".
function rangeForDays(days: number): string {
  if (days <= 55) return "3mo";
  if (days <= 130) return "6mo";
  return "1y";
}

export async function getYahooDailyCandles(symbol: string, days = 30): Promise<Candle[]> {
  return cached(`yahoo-candles:${symbol}:${days}`, CACHE_TTL_MS, async () => {
    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=${rangeForDays(days)}`;
    const res = await fetchWithRetry(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];

    // This is an undocumented endpoint — a 200 with a non-JSON body (e.g. a rate-limit/captcha
    // page) is plausible and must not take down the whole /api/stock response over just the
    // candles portion of it.
    let data: YahooChartResponse;
    try {
      data = await res.json();
    } catch {
      return [];
    }
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const candles: Candle[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      // Yahoo returns null for non-trading gaps inside the range; skip incomplete rows rather
      // than feeding NaN into the pattern engine.
      if (open == null || high == null || low == null || close == null) continue;
      candles.push({
        date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: quote.volume?.[i] ?? 0,
      });
    }

    return candles.slice(-days);
  });
}
