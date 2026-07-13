/**
 * Deterministic (never LLM-touched) 3-day price projection, in the same "code computes, AI only
 * explains" spirit as lib/patterns.ts. Trains a small gradient-boosted-trees model (lib/gbm.ts)
 * fresh per request on this symbol's own recent technical indicators — there is no cross-symbol
 * generalization claim and no persisted model. Presented as a widening probabilistic band plus an
 * honest out-of-sample directional-accuracy readout, not a confident single line, to stay
 * consistent with this app's "never a prediction stated as fact" guardrail (see IMPLEMENTATION_PLAN.md).
 */

import { detectPatterns, type Candle, type DetectedPattern } from "./patterns";
import { trainGbm, predictGbm, type TrainingRow, type GbmOptions } from "./gbm";

// How much history to request from the candle providers for training — well beyond the 30
// candles the chart displays. See lib/yahoo-candles.ts's rangeForDays for how this maps to an
// actual upstream fetch window.
export const PREDICTION_FETCH_DAYS = 150;

// Longest lookback any single feature needs (RSI's 14-day window is the widest).
const WARMUP = 14;
// Below this many (feature, label) rows, a trained model is more noise than signal for a
// single-ticker dataset with no cross-symbol generalization — bail out entirely rather than
// mislead (same "degrade gracefully on thin data" pattern used elsewhere in this codebase).
const MIN_USABLE_ROWS = 45;
const HOLDOUT_MIN_ROWS = 10;
const HOLDOUT_MAX_ROWS = 30;
// Below this many holdout trials, a directional hit-rate isn't meaningful enough to headline.
const HOLDOUT_DISPLAY_MIN = 15;
const HORIZON_DAYS = 3;

const GBM_OPTIONS: GbmOptions = { rounds: 50, learningRate: 0.08, maxDepth: 2, minLeafSize: 5 };

export interface PredictedPoint {
  date: string;
  predictedClose: number;
  low: number;
  high: number;
}

export interface PricePrediction {
  points: PredictedPoint[];
  directionalAccuracy: number | null;
  holdoutSize: number | null;
  methodology: string;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function dailyReturn(candles: Candle[], i: number): number {
  if (i < 1) return 0;
  const base = candles[i - 1].close;
  return base === 0 ? 0 : candles[i].close / base - 1;
}

function windowReturn(candles: Candle[], i: number, window: number): number {
  if (i < window) return 0;
  const base = candles[i - window].close;
  return base === 0 ? 0 : candles[i].close / base - 1;
}

function realizedVolatility(candles: Candle[], i: number, window: number): number {
  if (i < window) return 0;
  const rets: number[] = [];
  for (let j = i - window + 1; j <= i; j++) rets.push(dailyReturn(candles, j));
  return stddev(rets);
}

function smaGap(candles: Candle[], i: number, period: number): number {
  if (i < period - 1) return 0;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
  const sma = sum / period;
  return sma === 0 ? 0 : candles[i].close / sma - 1;
}

// Simplified 14-day RSI. Guarded per lib/patterns.ts's precedingTrend idiom (`if (start === 0)
// return "flat"`): no movement at all reads as a neutral 50, not a 0/0 NaN.
function rsi(candles: Candle[], i: number, period: number): number {
  if (i < period) return 50;
  let gains = 0;
  let losses = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const change = candles[j].close - candles[j - 1].close;
    if (change > 0) gains += change;
    else losses += -change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function volumeRatio(candles: Candle[], i: number, period: number): number {
  if (i < period) return 1;
  let sum = 0;
  for (let j = i - period; j < i; j++) sum += candles[j].volume;
  const avg = sum / period;
  return avg === 0 ? 1 : candles[i].volume / avg;
}

function patternSignalByDate(patterns: DetectedPattern[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of patterns) {
    const delta = p.signal === "bullish" ? 1 : p.signal === "bearish" ? -1 : 0;
    if (delta === 0) continue;
    map.set(p.date, (map.get(p.date) ?? 0) + delta);
  }
  return map;
}

// Causal by construction — only ever reads candles[0..i], so it's safe to call on a working
// array that's been extended with synthetic rollout candles past the real data.
function buildFeatureVector(candles: Candle[], patternSignal: Map<string, number>, i: number): number[] {
  const c = candles[i];
  const range = c.high - c.low;
  return [
    windowReturn(candles, i, 1),
    windowReturn(candles, i, 3),
    windowReturn(candles, i, 5),
    windowReturn(candles, i, 10),
    realizedVolatility(candles, i, 10),
    smaGap(candles, i, 10),
    rsi(candles, i, 14),
    range === 0 ? 0 : Math.abs(c.close - c.open) / range,
    range === 0 ? 0 : (c.high - Math.max(c.open, c.close)) / range,
    range === 0 ? 0 : (Math.min(c.open, c.close) - c.low) / range,
    patternSignal.get(c.date) ?? 0,
    volumeRatio(candles, i, 10),
  ];
}

/** Next `count` calendar dates after `fromDate`, skipping Saturdays/Sundays. No US market
 * holiday calendar — a projected date can occasionally land on a market holiday. Documented
 * limitation, not worth a full NYSE calendar for a cosmetic date-label improvement. */
export function nextTradingDays(fromDate: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${fromDate}T00:00:00Z`);
  while (dates.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Trains two models: one on all-but-a-chronological-holdout-tail (used only to score
 * out-of-sample directional accuracy and the band's residual spread — in-sample residuals would
 * understate uncertainty and oversell the feature), and one on the full dataset (used for the
 * actual recursive rollout, since by the time we're projecting forward we want every available
 * day of signal). Returns null on thin history rather than a misleadingly confident guess.
 */
export function getPricePrediction(candles: Candle[]): PricePrediction | null {
  if (candles.length < WARMUP + 2) return null;

  const patterns = detectPatterns(candles);
  const patternSignal = patternSignalByDate(patterns);

  const rows: TrainingRow[] = [];
  for (let i = WARMUP; i <= candles.length - 2; i++) {
    const base = candles[i].close;
    const label = base === 0 ? 0 : candles[i + 1].close / base - 1;
    rows.push({ features: buildFeatureVector(candles, patternSignal, i), label });
  }

  if (rows.length < MIN_USABLE_ROWS) return null;

  const holdoutSize = Math.min(HOLDOUT_MAX_ROWS, Math.max(HOLDOUT_MIN_ROWS, Math.round(rows.length * 0.2)));
  const trainRows = rows.slice(0, rows.length - holdoutSize);
  const holdoutRows = rows.slice(rows.length - holdoutSize);

  const holdoutModel = trainGbm(trainRows, GBM_OPTIONS);
  const residuals: number[] = [];
  let hits = 0;
  for (const row of holdoutRows) {
    const pred = predictGbm(holdoutModel, row.features);
    residuals.push(row.label - pred);
    if ((pred >= 0) === (row.label >= 0)) hits++;
  }
  const sigma = stddev(residuals);
  const accuracyIsDisplayable = holdoutRows.length >= HOLDOUT_DISPLAY_MIN;
  const directionalAccuracy = accuracyIsDisplayable ? hits / holdoutRows.length : null;

  const rolloutModel = trainGbm(rows, GBM_OPTIONS);

  const futureDates = nextTradingDays(candles[candles.length - 1].date, HORIZON_DAYS);
  const working: Candle[] = [...candles];
  const points: PredictedPoint[] = [];

  for (let step = 1; step <= HORIZON_DAYS; step++) {
    const features = buildFeatureVector(working, patternSignal, working.length - 1);
    const retPred = predictGbm(rolloutModel, features);
    const priorClose = working[working.length - 1].close;
    const predictedClose = priorClose * (1 + retPred);
    // Informal one-sigma-style band under a random-walk error-growth approximation (uncertainty
    // scales with sqrt of the horizon) — not a formal confidence interval; real returns are
    // fatter-tailed than this assumes.
    const spread = predictedClose * sigma * Math.sqrt(step);
    const date = futureDates[step - 1];
    points.push({ date, predictedClose, low: predictedClose - spread, high: predictedClose + spread });

    // Synthetic candle so the next step's features can be computed causally off the projected
    // path. Using the projected close for the whole synthetic OHLC range is a known approximation.
    working.push({
      date,
      open: priorClose,
      close: predictedClose,
      high: Math.max(priorClose, predictedClose),
      low: Math.min(priorClose, predictedClose),
      volume: working[working.length - 1].volume,
    });
  }

  return {
    points,
    directionalAccuracy,
    holdoutSize: accuracyIsDisplayable ? holdoutRows.length : null,
    methodology: `Gradient-boosted regression trees (${GBM_OPTIONS.rounds} rounds) trained on ${rows.length} days of this symbol's technical indicators`,
  };
}
