import { describe, expect, it } from "vitest";
import { detectPatterns, type Candle } from "./patterns";

function candle(date: string, open: number, high: number, low: number, close: number): Candle {
  return { date, open, high, low, close, volume: 1000 };
}

// Three candles with closes falling ~6% over the lookback window — enough to read as a downtrend.
const DOWNTREND_PRELUDE: Candle[] = [
  candle("2026-06-01", 100, 101, 99, 100),
  candle("2026-06-02", 100, 100.5, 96, 97),
  candle("2026-06-03", 97, 97.5, 93.5, 94),
];

// Three candles with closes rising ~6% — an uptrend.
const UPTREND_PRELUDE: Candle[] = [
  candle("2026-06-01", 100, 101, 99, 100),
  candle("2026-06-02", 100, 104, 99.5, 103),
  candle("2026-06-03", 103, 107, 102.5, 106),
];

// Closes barely move — under the 2% trend threshold, reads as flat.
const FLAT_PRELUDE: Candle[] = [
  candle("2026-06-01", 100, 101, 99, 100),
  candle("2026-06-02", 100, 100.8, 99.5, 100.3),
  candle("2026-06-03", 100.3, 100.9, 99.8, 100.2),
];

// Small body near the TOP of the range, long lower wick, negligible upper wick.
const HAMMER_SHAPE = candle("2026-06-04", 94, 94.6, 90, 94.5);
// Small body near the BOTTOM of the range, long upper wick, negligible lower wick.
// (Body ratio ~22% — comfortably "small" per SMALL_BODY_RATIO but above DOJI_BODY_RATIO,
// so this doesn't get classified as a Doji before the hammer-family check runs.)
const INVERTED_SHAPE = candle("2026-06-04", 94, 98.5, 93.9, 95);

describe("detectPatterns — Doji", () => {
  it("flags a candle where open and close are nearly identical", () => {
    const patterns = detectPatterns([candle("2026-06-01", 100, 102, 98, 100.05)]);
    expect(patterns.find((p) => p.name === "Doji")).toBeTruthy();
  });

  it("flags a zero-range candle (no intraday movement) as a doji", () => {
    const patterns = detectPatterns([candle("2026-06-01", 100, 100, 100, 100)]);
    expect(patterns.find((p) => p.name === "Doji")).toBeTruthy();
  });

  it("does not flag a candle with a large body relative to its range", () => {
    const patterns = detectPatterns([candle("2026-06-01", 100, 111, 99, 110)]);
    expect(patterns.find((p) => p.name === "Doji")).toBeUndefined();
  });
});

describe("detectPatterns — Hammer", () => {
  it("flags the shape as a Hammer after a downtrend", () => {
    const patterns = detectPatterns([...DOWNTREND_PRELUDE, HAMMER_SHAPE]);
    const hammer = patterns.find((p) => p.name === "Hammer");
    expect(hammer).toBeTruthy();
    expect(hammer?.signal).toBe("bullish");
  });

  it("does not flag the same shape as a Hammer after an uptrend (that's a Hanging Man, not in scope)", () => {
    const patterns = detectPatterns([...UPTREND_PRELUDE, HAMMER_SHAPE]);
    expect(patterns.find((p) => p.name === "Hammer")).toBeUndefined();
  });
});

describe("detectPatterns — Inverted Hammer / Shooting Star", () => {
  it("flags the shape as an Inverted Hammer after a downtrend", () => {
    const patterns = detectPatterns([...DOWNTREND_PRELUDE, INVERTED_SHAPE]);
    const pattern = patterns.find((p) => p.name === "Inverted Hammer");
    expect(pattern).toBeTruthy();
    expect(pattern?.signal).toBe("bullish");
  });

  it("flags the same shape as a Shooting Star after an uptrend", () => {
    const patterns = detectPatterns([...UPTREND_PRELUDE, INVERTED_SHAPE]);
    const pattern = patterns.find((p) => p.name === "Shooting Star");
    expect(pattern).toBeTruthy();
    expect(pattern?.signal).toBe("bearish");
  });

  it("flags neither after a flat trend (ambiguous context)", () => {
    const patterns = detectPatterns([...FLAT_PRELUDE, INVERTED_SHAPE]);
    expect(patterns.find((p) => p.name === "Inverted Hammer")).toBeUndefined();
    expect(patterns.find((p) => p.name === "Shooting Star")).toBeUndefined();
  });
});

describe("detectPatterns — Bullish Engulfing", () => {
  it("flags a bullish candle whose body fully engulfs the prior bearish candle", () => {
    const prev = candle("2026-06-01", 105, 106, 99, 100);
    const curr = candle("2026-06-02", 99, 107, 98, 106);
    const patterns = detectPatterns([prev, curr]);
    const pattern = patterns.find((p) => p.name === "Bullish Engulfing");
    expect(pattern).toBeTruthy();
    expect(pattern?.signal).toBe("bullish");
  });

  it("does not flag it when the second candle's body only partially covers the first", () => {
    const prev = candle("2026-06-01", 105, 106, 99, 100);
    const curr = candle("2026-06-02", 101, 107, 98, 104);
    const patterns = detectPatterns([prev, curr]);
    expect(patterns.find((p) => p.name === "Bullish Engulfing")).toBeUndefined();
  });
});

describe("detectPatterns — Bearish Engulfing", () => {
  it("flags a bearish candle whose body fully engulfs the prior bullish candle", () => {
    const prev = candle("2026-06-01", 100, 106, 99, 105);
    const curr = candle("2026-06-02", 106, 107, 98, 99);
    const patterns = detectPatterns([prev, curr]);
    const pattern = patterns.find((p) => p.name === "Bearish Engulfing");
    expect(pattern).toBeTruthy();
    expect(pattern?.signal).toBe("bearish");
  });

  it("does not flag it when the second candle's body only partially covers the first", () => {
    const prev = candle("2026-06-01", 100, 106, 99, 105);
    const curr = candle("2026-06-02", 104, 107, 98, 101);
    const patterns = detectPatterns([prev, curr]);
    expect(patterns.find((p) => p.name === "Bearish Engulfing")).toBeUndefined();
  });
});

describe("detectPatterns — edge cases", () => {
  it("returns an empty array for an empty candle list", () => {
    expect(detectPatterns([])).toEqual([]);
  });
});
