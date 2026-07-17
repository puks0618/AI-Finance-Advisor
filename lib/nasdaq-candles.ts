import { fetchWithRetry } from "./fetch-with-retry";
import { cached } from "./cache";
import type { Candle } from "./patterns";

const CACHE_TTL_MS = 60_000;

// Second, independent free/keyless daily-OHLC source, used by lib/candles.ts as a fallback when
// Yahoo's undocumented endpoint returns nothing (rate-limited, blocked, or changed shape without
// notice). Stooq's CSV download endpoint was tried first, but as of 2026-07 it gates every
// request — even with a browser User-Agent — behind a client-side JS proof-of-work challenge that
// a server-side fetch can never solve (verified by hand against the live endpoint, not assumed).
// Nasdaq's public chart API, also undocumented/unofficial but a genuinely separate provider,
// answers plain server-side requests with JSON as long as a browser-like User-Agent and an
// `Accept: application/json` header are sent — omit either and requests intermittently fail.
const BASE_URL = "https://api.nasdaq.com/api/quote";

interface NasdaqChartPoint {
  x?: number; // epoch ms
  z?: {
    open?: string;
    high?: string;
    low?: string;
    close?: string;
    volume?: string; // comma-grouped, e.g. "48,849,930"
  };
}

interface NasdaqChartResponse {
  data?: {
    chart?: NasdaqChartPoint[];
  } | null; // an unrecognized symbol returns `data: null` with HTTP 200, not an error status
}

function parseNumber(value: string | undefined): number {
  return value ? Number(value.replace(/,/g, "")) : NaN;
}

export function parseNasdaqChart(raw: NasdaqChartResponse): Candle[] {
  const points = raw.data?.chart ?? [];
  const candles: Candle[] = [];
  for (const point of points) {
    const open = parseNumber(point.z?.open);
    const high = parseNumber(point.z?.high);
    const low = parseNumber(point.z?.low);
    const close = parseNumber(point.z?.close);
    if (typeof point.x !== "number" || ![open, high, low, close].every(Number.isFinite)) continue;
    candles.push({
      date: new Date(point.x).toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume: parseNumber(point.z?.volume) || 0,
    });
  }
  return candles;
}

export async function getNasdaqDailyCandles(symbol: string, days = 30): Promise<Candle[]> {
  return cached(`nasdaq-candles:${symbol}:${days}`, CACHE_TTL_MS, async () => {
    const to = new Date();
    // Padded past `days` to cover weekends/holidays with no trading, same as Yahoo's 3-month
    // request window being wider than the 30 daily candles it actually returns.
    const from = new Date(to.getTime() - (days + 10) * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url =
      `${BASE_URL}/${encodeURIComponent(symbol)}/chart?assetclass=stocks` +
      `&fromdate=${fmt(from)}&todate=${fmt(to)}`;
    const res = await fetchWithRetry(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!res.ok) return [];

    let data: NasdaqChartResponse;
    try {
      data = await res.json();
    } catch {
      return [];
    }
    return parseNasdaqChart(data).slice(-days);
  });
}
