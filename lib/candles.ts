import { getYahooDailyCandles } from "./yahoo-candles";
import { getNasdaqDailyCandles } from "./nasdaq-candles";
import type { Candle } from "./patterns";

/**
 * Primary→fallback orchestrator for daily OHLC candles, mirroring the Gemini→Claude fallback
 * shape in lib/gemini.ts. Both underlying providers are unofficial/undocumented (no official
 * free candle API exists), so unlike the LLM fallback this exists purely for resilience against
 * one of them changing shape or getting rate-limited/blocked — not for choosing a "better" source.
 * Callers should import getDailyCandles from here, not from lib/yahoo-candles.ts or
 * lib/nasdaq-candles.ts directly.
 */
export async function getDailyCandles(symbol: string, days = 30): Promise<Candle[]> {
  const yahooCandles = await tryProvider(() => getYahooDailyCandles(symbol, days), "Yahoo", symbol);
  if (yahooCandles.length > 0) return yahooCandles;

  const nasdaqCandles = await tryProvider(() => getNasdaqDailyCandles(symbol, days), "Nasdaq", symbol);
  if (nasdaqCandles.length === 0) {
    // Both free sources came up empty — worth seeing in server logs even though callers already
    // degrade gracefully on empty candles (guardrail 6.12), since this is the signal that one or
    // both providers may have broken and need attention, not just an obscure/invalid ticker.
    console.warn(`getDailyCandles: both Yahoo and Nasdaq returned no candles for ${symbol}`);
  }
  return nasdaqCandles;
}

// Neither provider is expected to throw under normal conditions (both already catch their own
// JSON/CSV parsing failures and degrade to []), but the underlying fetch() call itself can throw
// on a genuine network error — that must fall through to the next provider, not fail the request.
async function tryProvider(fn: () => Promise<Candle[]>, name: string, symbol: string): Promise<Candle[]> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`getDailyCandles: ${name} provider threw for ${symbol}:`, err);
    return [];
  }
}
