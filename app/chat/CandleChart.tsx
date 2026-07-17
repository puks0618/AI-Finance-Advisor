"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface DetectedPattern {
  name: string;
  signal: "bullish" | "bearish" | "neutral";
  date: string;
  description: string;
}

interface MovingAveragePoint {
  date: string;
  value: number;
}

interface PredictedPoint {
  date: string;
  predictedClose: number;
  low: number;
  high: number;
}

interface PricePrediction {
  points: PredictedPoint[];
  directionalAccuracy: number | null;
  holdoutSize: number | null;
  methodology: string;
}

// Distinct from the bullish/bearish/neutral palette used elsewhere on this chart — reuses the
// app's warning-yellow so a projection reads visually as "uncertain," same semantic as the
// disclaimer's ⚠ icon.
const PROJECTION_COLOR = "#ffd84d";
const PROJECTION_BAND_COLOR = "rgba(255, 216, 77, 0.35)";

const SIGNAL_MARKER_COLOR: Record<DetectedPattern["signal"], string> = {
  bullish: "#3cff7a",
  bearish: "#ff4d6d",
  neutral: "#22d3ee",
};

export default function CandleChart({
  candles,
  patterns,
  movingAverage,
  prediction,
}: {
  candles: Candle[];
  patterns: DetectedPattern[];
  movingAverage: MovingAveragePoint[];
  prediction?: PricePrediction | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#93a69d",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(60, 255, 122, 0.06)" },
        horzLines: { color: "rgba(60, 255, 122, 0.06)" },
      },
      timeScale: { borderColor: "rgba(60, 255, 122, 0.16)" },
      rightPriceScale: { borderColor: "rgba(60, 255, 122, 0.16)" },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#3cff7a",
      downColor: "#ff4d6d",
      borderVisible: false,
      wickUpColor: "#3cff7a",
      wickDownColor: "#ff4d6d",
    });
    candleSeries.setData(
      candles.map((c) => ({
        time: c.date as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    if (movingAverage.length > 0) {
      const maSeries = chart.addSeries(LineSeries, {
        color: "#22d3ee",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      maSeries.setData(movingAverage.map((m) => ({ time: m.date as Time, value: m.value })));
    }

    if (patterns.length > 0) {
      const markers: SeriesMarker<Time>[] = patterns.map((p) => ({
        time: p.date as Time,
        position: p.signal === "bearish" ? "aboveBar" : "belowBar",
        shape: p.signal === "bullish" ? "arrowUp" : p.signal === "bearish" ? "arrowDown" : "circle",
        color: SIGNAL_MARKER_COLOR[p.signal],
        text: p.name,
      }));
      createSeriesMarkers(candleSeries, markers);
    }

    if (prediction && prediction.points.length > 0 && candles.length > 0) {
      // All three series share the last real candle as their first point so they visually
      // converge at "today" and fan out from there — a series' own ascending-time check is
      // independent of what other series already contain, so reusing that timestamp is fine.
      const anchor = candles[candles.length - 1];
      const bandSeriesOptions = {
        color: PROJECTION_BAND_COLOR,
        lineWidth: 1 as const,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      };

      const upperSeries = chart.addSeries(LineSeries, bandSeriesOptions);
      upperSeries.setData([
        { time: anchor.date as Time, value: anchor.close },
        ...prediction.points.map((p) => ({ time: p.date as Time, value: p.high })),
      ]);

      const lowerSeries = chart.addSeries(LineSeries, bandSeriesOptions);
      lowerSeries.setData([
        { time: anchor.date as Time, value: anchor.close },
        ...prediction.points.map((p) => ({ time: p.date as Time, value: p.low })),
      ]);

      const centerSeries = chart.addSeries(LineSeries, {
        color: PROJECTION_COLOR,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      centerSeries.setData([
        { time: anchor.date as Time, value: anchor.close },
        ...prediction.points.map((p) => ({ time: p.date as Time, value: p.predictedClose })),
      ]);
    }

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, patterns, movingAverage, prediction]);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}
