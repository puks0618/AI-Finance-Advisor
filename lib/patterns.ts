/**
 * Deterministic candlestick pattern detection — pure math over OHLC candles, no AI involved.
 * The AI only ever explains patterns detected here; it never detects them itself (LLMs are
 * unreliable at precise math). See IMPLEMENTATION_PLAN.md Section 2 for the rationale.
 */

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PatternSignal = "bullish" | "bearish" | "neutral";

export interface DetectedPattern {
  name: string;
  signal: PatternSignal;
  date: string;
  description: string;
}

// A body at or under 10% of the day's range means open and close were nearly identical (indecision).
const DOJI_BODY_RATIO = 0.1;
// A body at or under 30% of the range counts as "small" for the hammer-family shapes below.
const SMALL_BODY_RATIO = 0.3;
// The dominant wick must take up at least 60% of the range to count as "long".
const LONG_WICK_RATIO = 0.6;
// The opposite wick must take up at most 10% of the range to count as "negligible".
const SHORT_WICK_RATIO = 0.1;
// How many prior candles define the preceding trend, and how big a net move counts as a trend
// rather than noise. Both hammer-family shapes are geometric twins of a bearish counterpart
// (Hanging Man, Shooting Star) — only the trend beforehand tells them apart.
const TREND_LOOKBACK = 3;
const TREND_MOVE_THRESHOLD = 0.02;

function precedingTrend(candles: Candle[], index: number): "up" | "down" | "flat" {
  if (index < TREND_LOOKBACK) return "flat";
  const start = candles[index - TREND_LOOKBACK].close;
  const end = candles[index - 1].close;
  if (start === 0) return "flat";
  const change = (end - start) / start;
  if (change <= -TREND_MOVE_THRESHOLD) return "down";
  if (change >= TREND_MOVE_THRESHOLD) return "up";
  return "flat";
}

export function detectPatterns(candles: Candle[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    if (range === 0 || body / range <= DOJI_BODY_RATIO) {
      patterns.push({
        name: "Doji",
        signal: "neutral",
        date: c.date,
        description:
          "Open and close are nearly identical, reflecting indecision between buyers and sellers.",
      });
    } else {
      const smallBody = body / range <= SMALL_BODY_RATIO;
      const longLowerWick = lowerWick / range >= LONG_WICK_RATIO;
      const shortUpperWick = upperWick / range <= SHORT_WICK_RATIO;
      const longUpperWick = upperWick / range >= LONG_WICK_RATIO;
      const shortLowerWick = lowerWick / range <= SHORT_WICK_RATIO;

      if (smallBody && longLowerWick && shortUpperWick) {
        // Small body near the top of the range, long lower wick. This shape is a Hammer
        // (bullish) after a decline, or a Hanging Man (bearish) after a rally — same candle,
        // opposite meaning. Hanging Man isn't in this app's pattern list, so we only report
        // the Hammer case; labeling the same shape as "Hammer" mid-uptrend would be wrong.
        if (precedingTrend(candles, i) === "down") {
          patterns.push({
            name: "Hammer",
            signal: "bullish",
            date: c.date,
            description:
              "A small body near the top of the day's range with a long lower wick, following a decline — buyers stepped in after sellers pushed the price down.",
          });
        }
      } else if (smallBody && longUpperWick && shortLowerWick) {
        // Small body near the bottom of the range, long upper wick — the mirror-image twin
        // shape. Inverted Hammer (bullish) after a decline, Shooting Star (bearish) after a
        // rally. The trend beforehand is what makes the call, not the candle shape alone.
        const trend = precedingTrend(candles, i);
        if (trend === "down") {
          patterns.push({
            name: "Inverted Hammer",
            signal: "bullish",
            date: c.date,
            description:
              "A small body near the bottom of the day's range with a long upper wick, following a decline — an early sign buyers are testing higher prices.",
          });
        } else if (trend === "up") {
          patterns.push({
            name: "Shooting Star",
            signal: "bearish",
            date: c.date,
            description:
              "A small body near the bottom of the day's range with a long upper wick, following a rally — buyers pushed higher but sellers took control by the close.",
          });
        }
      }
    }

    if (i >= 1) {
      const prev = candles[i - 1];
      const prevBullish = prev.close > prev.open;
      const prevBearish = prev.close < prev.open;
      const currBullish = c.close > c.open;
      const currBearish = c.close < c.open;

      if (prevBearish && currBullish && c.open <= prev.close && c.close >= prev.open) {
        patterns.push({
          name: "Bullish Engulfing",
          signal: "bullish",
          date: c.date,
          description:
            "A bullish candle's body fully engulfs the prior bearish candle's body — buyers overwhelmed the prior session's sellers.",
        });
      }

      if (prevBullish && currBearish && c.open >= prev.close && c.close <= prev.open) {
        patterns.push({
          name: "Bearish Engulfing",
          signal: "bearish",
          date: c.date,
          description:
            "A bearish candle's body fully engulfs the prior bullish candle's body — sellers overwhelmed the prior session's buyers.",
        });
      }
    }
  }

  return patterns;
}
