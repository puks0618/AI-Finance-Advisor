"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
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

const SIGNAL_MARKER_COLOR: Record<DetectedPattern["signal"], string> = {
  bullish: "#3cff7a",
  bearish: "#ff4d6d",
  neutral: "#22d3ee",
};

export default function CandleChart({
  candles,
  patterns,
  movingAverage,
}: {
  candles: Candle[];
  patterns: DetectedPattern[];
  movingAverage: MovingAveragePoint[];
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

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, patterns, movingAverage]);

  return <div ref={containerRef} className="h-[320px] w-full" />;
}
