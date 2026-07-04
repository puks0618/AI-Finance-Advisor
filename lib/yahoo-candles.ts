import { fetchWithRetry } from "./fetch-with-retry";
import { cached } from "./cache";
import type { Candle } from "./patterns";

const CACHE_TTL_MS = 60_000;

// Finnhub's free tier no longer includes OHLC candles (confirmed 403 on /stock/candle as of
// 2026-07, regardless of symbol/params). This unofficial Yahoo Finance endpoint is the free
// substitute — no key required, verified working, but undocumented and could change without
// notice. If it breaks, this is the one file to replace.
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

export async function getDailyCandles(symbol: string, days = 30): Promise<Candle[]> {
  return cached(`candles:${symbol}:${days}`, CACHE_TTL_MS, async () => {
    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
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
