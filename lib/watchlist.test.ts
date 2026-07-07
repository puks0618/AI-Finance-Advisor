import { describe, expect, it } from "vitest";
import { evaluateCondition, isAlertCondition, describeTrigger, type AlertCondition } from "./watchlist";
import type { Quote } from "./finnhub";
import type { DetectedPattern } from "./patterns";

function quote(percentChange: number): Quote {
  return { current: 100, change: 0, percentChange, high: 0, low: 0, open: 0, previousClose: 0 };
}

function pattern(signal: DetectedPattern["signal"], name = "Test"): DetectedPattern {
  return { name, signal, date: "2026-06-01", description: "desc" };
}

describe("isAlertCondition", () => {
  it("accepts every known condition value", () => {
    expect(isAlertCondition("price_drop_5pct")).toBe(true);
    expect(isAlertCondition("price_rise_5pct")).toBe(true);
    expect(isAlertCondition("bullish_pattern")).toBe(true);
    expect(isAlertCondition("bearish_pattern")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    expect(isAlertCondition("delete_all_data")).toBe(false);
    expect(isAlertCondition("")).toBe(false);
    expect(isAlertCondition(42)).toBe(false);
    expect(isAlertCondition(undefined)).toBe(false);
  });
});

describe("evaluateCondition — price thresholds", () => {
  it("fires price_drop_5pct at or beyond -5%", () => {
    expect(evaluateCondition("price_drop_5pct", quote(-5), [])).toBe(true);
    expect(evaluateCondition("price_drop_5pct", quote(-7.2), [])).toBe(true);
  });

  it("does not fire price_drop_5pct short of the threshold", () => {
    expect(evaluateCondition("price_drop_5pct", quote(-4.9), [])).toBe(false);
    expect(evaluateCondition("price_drop_5pct", quote(3), [])).toBe(false);
  });

  it("fires price_rise_5pct at or beyond +5%", () => {
    expect(evaluateCondition("price_rise_5pct", quote(5), [])).toBe(true);
    expect(evaluateCondition("price_rise_5pct", quote(8), [])).toBe(true);
  });

  it("does not fire price_rise_5pct short of the threshold", () => {
    expect(evaluateCondition("price_rise_5pct", quote(4.9), [])).toBe(false);
  });

  it("never fires a price condition with no quote", () => {
    expect(evaluateCondition("price_drop_5pct", null, [])).toBe(false);
    expect(evaluateCondition("price_rise_5pct", null, [])).toBe(false);
  });
});

describe("evaluateCondition — pattern signals", () => {
  it("fires bullish_pattern only when a bullish pattern is present", () => {
    expect(evaluateCondition("bullish_pattern", null, [pattern("bullish")])).toBe(true);
    expect(evaluateCondition("bullish_pattern", null, [pattern("bearish"), pattern("neutral")])).toBe(false);
    expect(evaluateCondition("bullish_pattern", null, [])).toBe(false);
  });

  it("fires bearish_pattern only when a bearish pattern is present", () => {
    expect(evaluateCondition("bearish_pattern", null, [pattern("bearish")])).toBe(true);
    expect(evaluateCondition("bearish_pattern", null, [pattern("bullish")])).toBe(false);
  });
});

describe("describeTrigger", () => {
  it("describes price moves with a magnitude, never a directive", () => {
    const msg = describeTrigger("price_drop_5pct", "AAPL", quote(-6.4), []);
    expect(msg).toContain("AAPL");
    expect(msg).toContain("6.40%");
    expect(msg.toLowerCase()).not.toMatch(/\b(buy|sell|should)\b/);
  });

  it("describes a pattern hit by name and description", () => {
    const msg = describeTrigger("bullish_pattern", "TSLA", null, [pattern("bullish", "Hammer")]);
    expect(msg).toContain("TSLA");
    expect(msg).toContain("Hammer");
  });

  it("degrades gracefully when the expected data is missing", () => {
    const conditions: AlertCondition[] = ["price_drop_5pct", "bullish_pattern"];
    for (const c of conditions) {
      expect(() => describeTrigger(c, "AAPL", null, [])).not.toThrow();
    }
  });
});
