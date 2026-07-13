import { describe, expect, it } from "vitest";
import { getPricePrediction, nextTradingDays } from "./prediction";
import type { Candle } from "./patterns";

function candle(date: string, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { date, open, high, low, close, volume };
}

function dateAt(i: number): string {
  const d = new Date(Date.UTC(2026, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
}

function flatSeries(n: number, price = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => candle(dateAt(i), price, price, price, price, 1000));
}

// Deterministic drift + oscillation, no randomness, so the model actually sees varying features
// (unlike the flat series, which collapses every feature to a constant).
function trendingSeries(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * 0.1 + 2 * Math.sin(i / 3);
    const open = close - 0.5;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    const volume = 1000 + (i % 5) * 100;
    return candle(dateAt(i), open, high, low, close, volume);
  });
}

describe("getPricePrediction — insufficient history", () => {
  it("returns null for an empty candle list", () => {
    expect(getPricePrediction([])).toBeNull();
  });

  it("returns null when there aren't enough usable rows", () => {
    expect(getPricePrediction(flatSeries(50))).toBeNull();
  });
});

describe("getPricePrediction — flat series", () => {
  it("projects a constant price forward with zero spread", () => {
    const result = getPricePrediction(flatSeries(100));
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(3);
    for (const point of result!.points) {
      expect(point.predictedClose).toBeCloseTo(100, 5);
      expect(point.low).toBeCloseTo(100, 5);
      expect(point.high).toBeCloseTo(100, 5);
    }
  });
});

describe("getPricePrediction — band sanity", () => {
  it("keeps low <= predictedClose <= high for every point", () => {
    const result = getPricePrediction(trendingSeries(100));
    expect(result).not.toBeNull();
    for (const point of result!.points) {
      expect(point.low).toBeLessThanOrEqual(point.predictedClose);
      expect(point.predictedClose).toBeLessThanOrEqual(point.high);
    }
  });

  it("returns 3 ascending future dates", () => {
    const result = getPricePrediction(trendingSeries(100));
    expect(result).not.toBeNull();
    const dates = result!.points.map((p) => p.date);
    expect(dates).toHaveLength(3);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] > dates[i - 1]).toBe(true);
    }
  });
});

describe("getPricePrediction — directional accuracy thresholds", () => {
  it("suppresses the accuracy readout when the holdout is too small to be meaningful", () => {
    // 60 candles -> exactly MIN_USABLE_ROWS(45) usable rows -> holdoutSize=10, below the 15-row display floor.
    const result = getPricePrediction(trendingSeries(60));
    expect(result).not.toBeNull();
    expect(result!.directionalAccuracy).toBeNull();
    expect(result!.holdoutSize).toBeNull();
    expect(result!.points).toHaveLength(3);
  });

  it("reports a directional accuracy in [0,1] once the holdout clears the display floor", () => {
    const result = getPricePrediction(trendingSeries(100));
    expect(result).not.toBeNull();
    expect(result!.directionalAccuracy).not.toBeNull();
    expect(result!.directionalAccuracy!).toBeGreaterThanOrEqual(0);
    expect(result!.directionalAccuracy!).toBeLessThanOrEqual(1);
    expect(result!.holdoutSize).not.toBeNull();
    expect(result!.holdoutSize!).toBeGreaterThanOrEqual(15);
  });
});

describe("nextTradingDays", () => {
  it("skips the weekend when starting from a Thursday", () => {
    expect(nextTradingDays("2026-07-09", 3)).toEqual(["2026-07-10", "2026-07-13", "2026-07-14"]);
  });

  it("skips the weekend when starting from a Friday", () => {
    expect(nextTradingDays("2026-07-10", 3)).toEqual(["2026-07-13", "2026-07-14", "2026-07-15"]);
  });
});
