import { fetchWithRetry } from "./fetch-with-retry";
import { cached } from "./cache";

const BASE_URL = "https://finnhub.io/api/v1";
const CACHE_TTL_MS = 60_000;

export interface Quote {
  current: number;
  change: number;
  percentChange: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
}

export interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
}

function getApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    throw new Error("FINNHUB_API_KEY is not set.");
  }
  return key;
}

// 6.12 — Finnhub signals "unknown symbol" with a 200 OK and every field zeroed out, not an
// error status. Treat that as "no quote" rather than a real $0 price.
export async function getQuote(symbol: string): Promise<Quote | null> {
  return cached(`quote:${symbol}`, CACHE_TTL_MS, async () => {
    const url = `${BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${getApiKey()}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || (data.c === 0 && data.t === 0)) return null;
    return {
      current: data.c ?? 0,
      change: data.d ?? 0,
      percentChange: data.dp ?? 0,
      high: data.h ?? 0,
      low: data.l ?? 0,
      open: data.o ?? 0,
      previousClose: data.pc ?? 0,
    };
  });
}

/**
 * Last 7 days of company news, most recent first. No news for a symbol is a valid result ([]),
 * not an error — but a missing FINNHUB_API_KEY is a config error, not a per-symbol condition,
 * and still throws (via getApiKey()) so a misconfigured deploy fails loudly instead of quietly
 * returning "no news" forever.
 */
export async function getCompanyNews(symbol: string, limit = 5): Promise<NewsItem[]> {
  return cached(`news:${symbol}:${limit}`, CACHE_TTL_MS, async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `${BASE_URL}/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${getApiKey()}`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
      .slice(0, limit)
      .map((item) => ({
        headline: item.headline ?? "",
        summary: item.summary ?? "",
        source: item.source ?? "",
        url: item.url ?? "",
        datetime: item.datetime ?? 0,
      }));
  });
}
