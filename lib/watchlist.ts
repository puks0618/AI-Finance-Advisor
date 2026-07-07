/**
 * Deterministic watchlist-condition evaluation — same "code decides, AI only explains" boundary
 * as lib/patterns.ts. Whether an alert fires is pure math/logic over already-fetched market data,
 * never an AI judgment call.
 */

import type { Quote } from "./finnhub";
import type { DetectedPattern } from "./patterns";

export type AlertCondition = "price_drop_5pct" | "price_rise_5pct" | "bullish_pattern" | "bearish_pattern";

export const ALERT_CONDITIONS: { value: AlertCondition; label: string }[] = [
  { value: "price_drop_5pct", label: "Price drops 5%+ in a day" },
  { value: "price_rise_5pct", label: "Price rises 5%+ in a day" },
  { value: "bullish_pattern", label: "A bullish candlestick pattern appears" },
  { value: "bearish_pattern", label: "A bearish candlestick pattern appears" },
];

// An allowlist check closes off prompt/query injection through this field entirely, same as
// validateRiskProfile in lib/guardrails.ts — no free-text condition ever reaches the database.
export function isAlertCondition(value: unknown): value is AlertCondition {
  return typeof value === "string" && ALERT_CONDITIONS.some((c) => c.value === value);
}

const PRICE_MOVE_THRESHOLD = 5;

export function evaluateCondition(
  condition: AlertCondition,
  quote: Quote | null,
  patterns: DetectedPattern[]
): boolean {
  switch (condition) {
    case "price_drop_5pct":
      return quote !== null && quote.percentChange <= -PRICE_MOVE_THRESHOLD;
    case "price_rise_5pct":
      return quote !== null && quote.percentChange >= PRICE_MOVE_THRESHOLD;
    case "bullish_pattern":
      return patterns.some((p) => p.signal === "bullish");
    case "bearish_pattern":
      return patterns.some((p) => p.signal === "bearish");
  }
}

// Plain-fact description of what fired — never a directive, matching guardrail 6.1 (this is
// reporting a detected condition, not advice on what to do about it).
export function describeTrigger(
  condition: AlertCondition,
  symbol: string,
  quote: Quote | null,
  patterns: DetectedPattern[]
): string {
  switch (condition) {
    case "price_drop_5pct":
      return `${symbol} dropped ${Math.abs(quote?.percentChange ?? 0).toFixed(2)}% today.`;
    case "price_rise_5pct":
      return `${symbol} rose ${(quote?.percentChange ?? 0).toFixed(2)}% today.`;
    case "bullish_pattern": {
      const match = patterns.find((p) => p.signal === "bullish");
      return `${symbol} formed a ${match?.name ?? "bullish"} pattern${match ? `: ${match.description}` : "."}`;
    }
    case "bearish_pattern": {
      const match = patterns.find((p) => p.signal === "bearish");
      return `${symbol} formed a ${match?.name ?? "bearish"} pattern${match ? `: ${match.description}` : "."}`;
    }
  }
}

// Caps unique symbols a single account can ask the cron job to fetch per run — protects Finnhub's
// free-tier rate limit (6.4) from an unbounded watchlist, not a meaningful product restriction.
export const MAX_WATCHLIST_ITEMS_PER_USER = 10;
