import { describe, expect, it } from "vitest";
import { parseNasdaqChart } from "./nasdaq-candles";

describe("parseNasdaqChart", () => {
  it("parses a well-formed chart response into Candle rows", () => {
    const response = {
      data: {
        chart: [
          {
            x: 1780272000000, // 2026-06-01T00:00:00Z
            z: { high: "310.94", low: "305.02", open: "309.625", close: "306.31", volume: "48,849,930" },
          },
          {
            x: 1780358400000, // 2026-06-02T00:00:00Z
            z: { high: "315.45", low: "306.685", open: "307.46", close: "315.2", volume: "44,534,720" },
          },
        ],
      },
    };
    expect(parseNasdaqChart(response)).toEqual([
      { date: "2026-06-01", open: 309.625, high: 310.94, low: 305.02, close: 306.31, volume: 48849930 },
      { date: "2026-06-02", open: 307.46, high: 315.45, low: 306.685, close: 315.2, volume: 44534720 },
    ]);
  });

  // An unrecognized symbol returns `{"data": null, ...}` with an HTTP 200 (not an error status),
  // so this shape — not a thrown error or a non-2xx response — is the real "not found" signal.
  it("returns no candles when data is null (unrecognized symbol)", () => {
    expect(parseNasdaqChart({ data: null })).toEqual([]);
  });

  it("returns no candles when the chart array is missing or empty", () => {
    expect(parseNasdaqChart({})).toEqual([]);
    expect(parseNasdaqChart({ data: { chart: [] } })).toEqual([]);
  });

  it("skips points with a missing timestamp or non-numeric OHLC fields rather than throwing", () => {
    const response = {
      data: {
        chart: [
          { x: 1780272000000, z: { high: "310.94", low: "305.02", open: "309.625", close: "306.31" } },
          { z: { high: "310.94", low: "305.02", open: "309.625", close: "306.31" } }, // missing x
          { x: 1780358400000, z: { high: "N/A", low: "305.02", open: "309.625", close: "306.31" } },
        ],
      },
    };
    expect(parseNasdaqChart(response)).toEqual([
      { date: "2026-06-01", open: 309.625, high: 310.94, low: 305.02, close: 306.31, volume: 0 },
    ]);
  });
});
