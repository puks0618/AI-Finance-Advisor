"use client";

import { useState, useEffect, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import CandleChart from "./CandleChart";
import DecisionTreeView from "./DecisionTreeView";
import { useSpeech } from "@/lib/useSpeech";

interface Message {
  role: "user" | "model";
  text: string;
}

interface Quote {
  current: number;
  change: number;
  percentChange: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
}

interface DetectedPattern {
  name: string;
  signal: "bullish" | "bearish" | "neutral";
  date: string;
  description: string;
}

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
}

interface PatternBias {
  bullish: number;
  bearish: number;
  neutral: number;
}

interface Sentiment {
  bullish: number;
  neutral: number;
  bearish: number;
}

interface DecisionTreeOutcome {
  sector: string;
  pressure: "upward" | "downward" | "neutral";
  reason: string;
}

interface DecisionTreeBranch {
  label: string;
  children?: DecisionTreeBranch[];
  outcome?: DecisionTreeOutcome;
}

interface DecisionTree {
  event: string;
  summaryParagraph: string;
  root: DecisionTreeBranch;
  summary: DecisionTreeOutcome[];
}

interface StockResult {
  symbol: string;
  quote: Quote | null;
  candles: Candle[];
  patterns: DetectedPattern[];
  patternBias: PatternBias;
  movingAverage: MovingAveragePoint[];
  prediction: PricePrediction | null;
  news: NewsItem[];
  brief: string;
  sentiment: Sentiment | null;
  upsideScenario: string | null;
  downsideScenario: string | null;
  decisionTree: DecisionTree | null;
  dataDelayed: boolean;
}

interface SubscriptionInfo {
  status: string | null;
  remainingToday: number | null;
  dailyLimit: number;
}

// Gemini replies use **bold** markdown; render it as real emphasis instead of literal asterisks.
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-[var(--text-primary)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// SpeechSynthesis reads "**" literally as asterisks — strip the markdown bold markers before speaking.
function stripForSpeech(text: string): string {
  return text.replace(/\*\*/g, "");
}

// News headline URLs come from a third-party API (Finnhub), not user input, so this is
// defense-in-depth rather than a response to a known attack — but a malformed/compromised upstream
// feed returning a `javascript:` URL should never end up in an <a href>.
function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Deterministic, code-computed lean from data already on the page (pattern bias + news
// sentiment) — never LLM-generated, so it can't drift into a buy/sell/hold directive. Returns
// null when neither signal is available rather than forcing a reading out of nothing (6.12).
function computeSignalLean(
  patternBias: PatternBias,
  sentiment: Sentiment | null
): { score: number; lean: "bullish" | "bearish" | "neutral" } | null {
  const scores: number[] = [];
  const totalPatterns = patternBias.bullish + patternBias.bearish + patternBias.neutral;
  if (totalPatterns > 0) {
    scores.push(((patternBias.bullish - patternBias.bearish) / totalPatterns) * 100);
  }
  if (sentiment) {
    scores.push(sentiment.bullish - sentiment.bearish);
  }
  if (scores.length === 0) return null;

  const score = scores.reduce((a, b) => a + b, 0) / scores.length;
  const lean = score >= 30 ? "bullish" : score <= -30 ? "bearish" : "neutral";
  return { score, lean };
}

const LEAN_LABEL: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "Bullish lean",
  bearish: "Bearish lean",
  neutral: "Mixed / neutral",
};

const LEAN_COLOR: Record<"bullish" | "bearish" | "neutral", string> = {
  bullish: "text-neon-green",
  bearish: "text-neon-pink",
  neutral: "text-neon-cyan",
};

function SignalGauge({ patternBias, sentiment }: { patternBias: PatternBias; sentiment: Sentiment | null }) {
  const result = computeSignalLean(patternBias, sentiment);
  if (!result) return null;
  const { score, lean } = result;
  const position = Math.min(100, Math.max(0, (score + 100) / 2));

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">Signal lean</h3>
        <span className={`text-sm font-semibold ${LEAN_COLOR[lean]}`}>{LEAN_LABEL[lean]}</span>
      </div>
      <div
        className="relative h-2 rounded-full"
        style={{ background: "linear-gradient(90deg, var(--neon-pink), var(--neon-cyan), var(--neon-green))" }}
      >
        <div
          className="absolute -top-1 h-4 w-1 rounded-full bg-white shadow"
          style={{ left: `${position}%`, transform: "translateX(-50%)" }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        A snapshot of how detected candlestick patterns and recent news tone currently lean —
        not a forecast, and not a recommendation to buy, sell, or hold.
      </p>
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-xs leading-5 text-[var(--text-muted)]">
      <span className="text-neon-yellow">⚠</span>
      <p>
        This is a research and education tool, not a licensed financial advisor. It won&apos;t
        tell you to buy or sell anything — for major financial decisions, consult a qualified
        professional.
      </p>
    </div>
  );
}

// Shared between the general advisor entry point and the per-alert "Discuss this" shortcut —
// both just POST to the same rate-limited /api/calls route with a different context.
function CallAdvisorButton({
  context,
  alertId,
  label,
}: {
  context: "general" | "alert";
  alertId?: string;
  label: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; href?: string; hrefLabel?: string } | null>(
    null
  );

  async function handleCall() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, alertId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          setResult({ ok: false, text: "Log in to call the AI Advisor.", href: "/login", hrefLabel: "Log in" });
        } else if (data.code === "unsupported_region") {
          setResult({ ok: false, text: data.error });
        } else if (res.status === 400 && String(data.error ?? "").toLowerCase().includes("phone")) {
          setResult({ ok: false, text: data.error, href: "/profile", hrefLabel: "Verify a number" });
        } else {
          setResult({ ok: false, text: data.error ?? "Something went wrong. Please try again." });
        }
        return;
      }
      setResult({ ok: true, text: "Calling you now — pick up!" });
    } catch {
      setResult({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleCall}
        disabled={loading}
        className={context === "alert" ? "text-xs text-neon-cyan hover:underline" : "btn-neon px-4 py-2 text-sm"}
      >
        {loading ? "Calling…" : label}
      </button>
      {result && (
        <p className={`text-xs ${result.ok ? "text-neon-green" : "text-neon-pink"}`}>
          {result.text}{" "}
          {result.href && (
            <Link href={result.href} className="underline">
              {result.hrefLabel}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

function ModeToggle({
  mode,
  setMode,
}: {
  mode: "advisor" | "stock" | "watchlist";
  setMode: (m: "advisor" | "stock" | "watchlist") => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setMode("advisor")}
        className={`px-4 py-2 text-sm font-medium ${mode === "advisor" ? "btn-neon" : "btn-ghost"}`}
      >
        💬 Finance Advisor
      </button>
      <button
        type="button"
        onClick={() => setMode("stock")}
        className={`px-4 py-2 text-sm font-medium ${mode === "stock" ? "btn-neon" : "btn-ghost"}`}
      >
        📈 Stock Research
      </button>
      <button
        type="button"
        onClick={() => setMode("watchlist")}
        className={`px-4 py-2 text-sm font-medium ${mode === "watchlist" ? "btn-neon" : "btn-ghost"}`}
      >
        ⭐ Watchlist
      </button>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "I'm 28, earn $70k, and have no savings yet — where do I start?",
  "I have $10k in credit card debt at 22% APR. What should I focus on?",
  "How much should I keep in an emergency fund?",
];

function AdvisorPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakReplies, setSpeakReplies] = useState(false);
  const {
    micSupported,
    speechSupported,
    listening,
    error: micError,
    startListening,
    stopListening,
    speak,
    cancelSpeech,
  } = useSpeech();

  async function submitMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const history = messages;
    setMessages([...history, { role: "user", text: trimmed }]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }
      setMessages((prev) => [...prev, { role: "model", text: data.reply }]);
      if (speakReplies) speak(stripForSpeech(data.reply));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitMessage(input);
  }

  function handleMicClick() {
    if (listening) {
      stopListening();
      return;
    }
    if (speakReplies) cancelSpeech();
    startListening((text, isFinal) => {
      setInput(text);
      if (isFinal) submitMessage(text);
    });
  }

  function toggleSpeakReplies() {
    setSpeakReplies((prev) => {
      if (prev) cancelSpeech();
      return !prev;
    });
  }

  return (
    <>
      <div className="mb-4">
        <CallAdvisorButton context="general" label="📞 Call the AI Advisor" />
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              Tell me about your income, savings goals, or what&apos;s on your mind financially —
              I&apos;ll ask a few questions before offering any thoughts.
            </p>
            <div className="flex flex-col gap-2">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => submitMessage(p)}
                  className="glass-card px-4 py-2.5 text-left text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  &ldquo;{p}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
              m.role === "user"
                ? "self-end font-medium text-[#04140a]"
                : "glass-card self-start text-[var(--text-primary)]"
            }`}
            style={
              m.role === "user"
                ? { background: "linear-gradient(135deg, var(--neon-green), var(--neon-cyan))" }
                : undefined
            }
          >
            {m.role === "model" ? renderInline(m.text) : m.text}
          </div>
        ))}
        {loading && (
          <div className="glass-card flex items-center gap-1.5 self-start px-4 py-3">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--neon-green)]" />
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--neon-green)]" />
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--neon-green)]" />
          </div>
        )}
      </div>

      {error && <div className="glass-card glass-card-pink mt-4 px-4 py-3 text-sm text-neon-pink">{error}</div>}

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        {micSupported && (
          <button
            type="button"
            onClick={handleMicClick}
            title={listening ? "Stop listening" : "Speak your message"}
            aria-pressed={listening}
            className={`px-3 py-3 text-sm ${listening ? "btn-neon" : "btn-ghost"}`}
            style={listening ? { background: "linear-gradient(135deg, var(--neon-pink), var(--neon-cyan))" } : undefined}
          >
            {listening ? "⏹" : "🎙"}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Type a message…"}
          maxLength={4000}
          className="input-neon min-w-0 flex-1 px-4 py-3 text-sm"
        />
        {speechSupported && (
          <button
            type="button"
            onClick={toggleSpeakReplies}
            title={speakReplies ? "Stop reading replies aloud" : "Read replies aloud"}
            aria-pressed={speakReplies}
            className={`px-3 py-3 text-sm ${speakReplies ? "btn-neon" : "btn-ghost"}`}
          >
            {speakReplies ? "🔊" : "🔇"}
          </button>
        )}
        <button type="submit" disabled={loading || !input.trim()} className="btn-neon px-6 py-3 text-sm">
          Send
        </button>
      </form>
      {!micSupported && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Voice input isn&apos;t available in this browser — it works best in Chrome or Edge. Typing
          still works great.
        </p>
      )}
      {micError && <p className="mt-2 text-xs text-neon-pink">{micError}</p>}
    </>
  );
}

const SIGNAL_STYLES: Record<DetectedPattern["signal"], string> = {
  bullish: "border border-[rgba(60,255,122,0.4)] bg-[rgba(60,255,122,0.1)] text-neon-green",
  bearish: "border border-[rgba(255,77,109,0.4)] bg-[rgba(255,77,109,0.1)] text-neon-pink",
  neutral: "border border-[rgba(34,211,238,0.35)] bg-[rgba(34,211,238,0.08)] text-neon-cyan",
};

const SIGNAL_LEGEND: { signal: DetectedPattern["signal"]; label: string; hint: string }[] = [
  { signal: "bullish", label: "Bullish", hint: "Buyers overwhelmed sellers in the pattern" },
  { signal: "bearish", label: "Bearish", hint: "Sellers overwhelmed buyers in the pattern" },
  { signal: "neutral", label: "Neutral", hint: "Indecision between buyers and sellers" },
];

function StockPanel() {
  const [symbol, setSymbol] = useState("");
  const [result, setResult] = useState<StockResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<"login" | "upgrade" | null>(null);
  const [usage, setUsage] = useState<SubscriptionInfo | null>(null);

  function refreshUsage() {
    fetch("/api/subscription")
      .then((res) => res.json())
      .then((data) => setUsage(data))
      .catch(() => {
        // Usage badge is a nice-to-have; never block research over it.
      });
  }

  useEffect(() => {
    refreshUsage();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = symbol.trim();
    if (!trimmed || loading) return;

    setError(null);
    setGate(null);
    setLoading(true);

    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: trimmed, riskProfile: "moderate" }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) setGate("login");
        if (res.status === 402) setGate("upgrade");
        throw new Error(data.error ?? "Something went wrong. Please try again.");
      }
      setResult(data);
      refreshUsage();
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {usage?.status === "active" ? (
        <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-neon-green">
          ⚡ Pro · Unlimited research
        </div>
      ) : usage?.remainingToday !== null && usage?.remainingToday !== undefined ? (
        <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-secondary)]">
          {usage.remainingToday} of {usage.dailyLimit} free requests left today
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Ticker symbol, e.g. AAPL"
          maxLength={6}
          className="input-neon min-w-0 flex-1 px-4 py-3 text-sm uppercase"
        />
        <button type="submit" disabled={loading || !symbol.trim()} className="btn-neon px-6 py-3 text-sm">
          {loading ? "Researching…" : "Research"}
        </button>
      </form>

      {error && (
        <div className="glass-card glass-card-pink mb-4 px-4 py-3 text-sm text-neon-pink">
          <p>{error}</p>
          {gate === "login" && (
            <Link href="/login" className="btn-ghost mt-3 inline-flex px-4 py-1.5 text-xs font-medium text-[var(--text-primary)]">
              Log in
            </Link>
          )}
          {gate === "upgrade" && (
            <Link href="/pricing" className="btn-neon mt-3 inline-flex px-4 py-1.5 text-xs">
              Upgrade to Pro
            </Link>
          )}
        </div>
      )}

      {!result && !error && !loading && (
        <p className="text-sm text-[var(--text-secondary)]">
          Enter a ticker to get a price snapshot, detected candlestick patterns, and a
          plain-English research brief tailored to a moderate risk profile. Requires an account;
          free accounts get 5 requests per day.
        </p>
      )}

      {result && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          <div className="glass-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="neon-heading text-lg font-bold">{result.symbol}</h2>
              {result.quote && (
                <span
                  className={`font-mono ${result.quote.change >= 0 ? "text-neon-green" : "text-neon-pink"}`}
                >
                  {result.quote.current.toFixed(2)} ({result.quote.change >= 0 ? "+" : ""}
                  {result.quote.percentChange.toFixed(2)}%)
                </span>
              )}
            </div>
            {result.dataDelayed && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Prices delayed ~15-20 minutes, not real-time.
              </p>
            )}
          </div>

          <SignalGauge patternBias={result.patternBias} sentiment={result.sentiment} />

          {result.candles.length > 0 && (
            <div className="glass-card p-4">
              <CandleChart
                candles={result.candles}
                patterns={result.patterns}
                movingAverage={result.movingAverage}
                prediction={result.prediction}
              />
              <p className="mt-3 text-xs text-[var(--text-muted)]">
                Markers show detected patterns; the cyan line is a 10-day moving average of real
                closes — a smoothing indicator, not a forecast. Solid candles are real historical
                data; the dashed line and band, when shown, are a statistical projection from a
                model trained on this symbol&apos;s recent technical indicators — not a forecast,
                not a recommendation, and not guaranteed.
              </p>
              {result.prediction && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {result.prediction.directionalAccuracy !== null && result.prediction.holdoutSize !== null
                    ? `≈${Math.round(result.prediction.directionalAccuracy * 100)}% directional hit-rate on this symbol's last ${result.prediction.holdoutSize} sessions — for context on how weak this edge is, not a guarantee.`
                    : "Not enough history yet for a meaningful accuracy readout — treat the projection as illustrative only."}
                </p>
              )}
            </div>
          )}

          <div className="glass-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--text-secondary)]">Detected patterns</h3>
              <div className="flex gap-2">
                {SIGNAL_LEGEND.map((l) => (
                  <span
                    key={l.signal}
                    title={l.hint}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SIGNAL_STYLES[l.signal]}`}
                  >
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
            {result.patterns.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No notable candlestick patterns in the recent data.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.patterns.map((p, i) => (
                  <li key={i} className="text-sm">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${SIGNAL_STYLES[p.signal]}`}>
                      {p.name}
                    </span>
                    <span className="text-[var(--text-secondary)]">{p.description}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Detected deterministically from real price data — code, not a prediction.
              {" · "}Pattern bias: {result.patternBias.bullish} bullish · {result.patternBias.bearish} bearish
              · {result.patternBias.neutral} neutral
            </p>
          </div>

          {result.sentiment && (
            <div className="glass-card p-4">
              <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">News sentiment</h3>
              <div className="flex h-2 overflow-hidden rounded-full bg-[var(--bg-surface-strong)]">
                {result.sentiment.bullish > 0 && (
                  <div style={{ width: `${result.sentiment.bullish}%`, background: "var(--neon-green)" }} />
                )}
                {result.sentiment.neutral > 0 && (
                  <div style={{ width: `${result.sentiment.neutral}%`, background: "var(--neon-cyan)" }} />
                )}
                {result.sentiment.bearish > 0 && (
                  <div style={{ width: `${result.sentiment.bearish}%`, background: "var(--neon-pink)" }} />
                )}
              </div>
              <div className="mt-2 flex gap-4 text-xs text-[var(--text-secondary)]">
                <span className="text-neon-green">{result.sentiment.bullish}% bullish</span>
                <span className="text-neon-cyan">{result.sentiment.neutral}% neutral</span>
                <span className="text-neon-pink">{result.sentiment.bearish}% bearish</span>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Read from recent headline tone — not a forecast.
              </p>
            </div>
          )}

          <div className="glass-card p-4 text-sm leading-6 whitespace-pre-wrap text-[var(--text-primary)]">
            {renderInline(result.brief)}
          </div>

          {(result.upsideScenario || result.downsideScenario) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {result.upsideScenario && (
                <div className="glass-card p-4">
                  <h3 className="mb-2 text-sm font-medium text-neon-green">Upside scenario</h3>
                  <p className="text-sm leading-6 text-[var(--text-secondary)]">{result.upsideScenario}</p>
                </div>
              )}
              {result.downsideScenario && (
                <div className="glass-card glass-card-pink p-4">
                  <h3 className="mb-2 text-sm font-medium text-neon-pink">Downside scenario</h3>
                  <p className="text-sm leading-6 text-[var(--text-secondary)]">{result.downsideScenario}</p>
                </div>
              )}
            </div>
          )}

          {result.decisionTree && <DecisionTreeView tree={result.decisionTree} />}

          {result.news.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">Recent headlines</h3>
              <ul className="flex flex-col gap-2">
                {result.news.map((n, i) => (
                  <li key={i} className="text-sm">
                    {isSafeExternalUrl(n.url) ? (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--text-primary)] underline decoration-[var(--border-subtle)] hover:text-neon-cyan hover:decoration-neon-cyan"
                      >
                        {n.headline}
                      </a>
                    ) : (
                      <span className="text-[var(--text-primary)]">{n.headline}</span>
                    )}
                    <span className="ml-1 text-xs text-[var(--text-muted)]">({n.source})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

interface WatchlistItem {
  id: string;
  symbol: string;
  condition: string;
  created_at: string;
}

interface AlertItem {
  id: string;
  symbol: string;
  condition: string;
  message: string;
  triggered_at: string;
}

const CONDITION_OPTIONS: { value: string; label: string }[] = [
  { value: "price_drop_5pct", label: "Price drops 5%+ in a day" },
  { value: "price_rise_5pct", label: "Price rises 5%+ in a day" },
  { value: "bullish_pattern", label: "A bullish candlestick pattern appears" },
  { value: "bearish_pattern", label: "A bearish candlestick pattern appears" },
];

function conditionLabel(value: string): string {
  return CONDITION_OPTIONS.find((c) => c.value === value)?.label ?? value;
}

function WatchlistPanel() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [symbol, setSymbol] = useState("");
  const [condition, setCondition] = useState(CONDITION_OPTIONS[0].value);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<"login" | null>(null);
  const [loaded, setLoaded] = useState(false);

  function refresh() {
    fetch("/api/watchlist")
      .then((res) => {
        if (res.status === 401) {
          setGate("login");
          return null;
        }
        setGate(null);
        return res.json();
      })
      .then((data) => {
        if (data) {
          setItems(data.watchlist ?? []);
          setAlerts(data.alerts ?? []);
        }
      })
      .catch(() => {
        // A failed refresh just leaves the last known list in place.
      })
      .finally(() => setLoaded(true));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const trimmed = symbol.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: trimmed, condition }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setSymbol("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Something went wrong. Please try again.");
      }
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (gate === "login") {
    return (
      <div className="glass-card p-4 text-sm text-[var(--text-secondary)]">
        <Link href="/login" className="text-neon-cyan underline">
          Log in
        </Link>{" "}
        to build a watchlist and get alerted when a condition is met.
      </div>
    );
  }

  if (!loaded) return null;

  return (
    <>
      <form onSubmit={handleAdd} className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Ticker symbol, e.g. AAPL"
          maxLength={6}
          className="input-neon px-4 py-3 text-sm uppercase sm:flex-1"
        />
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className="input-neon px-4 py-3 text-sm sm:w-64"
        >
          {CONDITION_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={loading || !symbol.trim()} className="btn-neon px-6 py-3 text-sm">
          {loading ? "Adding…" : "Add"}
        </button>
      </form>

      <p className="mb-4 text-xs leading-5 text-[var(--text-muted)]">
        Conditions are checked once a day, not continuously — you may not see same-day intraday
        moves reflected until the next check.
      </p>

      {error && <div className="glass-card glass-card-pink mb-4 px-4 py-3 text-sm text-neon-pink">{error}</div>}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        <div className="glass-card p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Watching</h3>
          {items.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Nothing on your watchlist yet. Add a ticker and a condition above.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium text-[var(--text-primary)]">{item.symbol}</span>{" "}
                    <span className="text-[var(--text-secondary)]">— {conditionLabel(item.condition)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="text-xs text-neon-pink hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[var(--text-muted)]">
            Checked once daily by a scheduled job — this is a research monitor, not real-time
            trading, and never tells you to buy or sell.
          </p>
        </div>

        <div className="glass-card p-4">
          <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">Recent alerts</h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No alerts triggered yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {alerts.map((a) => (
                <li key={a.id} className="text-sm">
                  <p className="text-[var(--text-primary)]">{a.message}</p>
                  <div className="mt-1 flex items-center gap-3">
                    <p className="text-xs text-[var(--text-muted)]">{new Date(a.triggered_at).toLocaleString()}</p>
                    <CallAdvisorButton context="alert" alertId={a.id} label="📞 Discuss this" />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function AuthHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setChecked(true);
      if (data.user) {
        fetch("/api/subscription")
          .then((r) => r.json())
          .then((d) => setIsPro(d.status === "active"))
          .catch(() => null);
        supabase
          .from("profiles")
          .select("full_name")
          .eq("id", data.user.id)
          .maybeSingle()
          .then(({ data: profile }) => setDisplayName(profile?.full_name ?? null));
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (!checked) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <Link href="/" className="font-bold tracking-tight">
        <span className="neon-heading">AI Finance Advisor</span>
      </Link>
      <div className="flex flex-wrap items-center gap-3 text-[var(--text-secondary)]">
        <Link href="/pricing" className="hover:text-[var(--text-primary)]">
          Pricing
        </Link>
        {user ? (
          <>
            {isPro && (
              <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-semibold text-neon-green">
                PRO
              </span>
            )}
            <Link href="/profile" className="max-w-[140px] truncate hover:text-[var(--text-primary)] sm:max-w-[220px]">
              {displayName || user.email}
            </Link>
            <button onClick={handleLogout} className="underline hover:text-[var(--text-primary)]">
              Log out
            </button>
          </>
        ) : (
          <Link href="/login" className="underline hover:text-[var(--text-primary)]">
            Log in to save your profile
          </Link>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [mode, setMode] = useState<"advisor" | "stock" | "watchlist">("advisor");

  return (
    <div className="flex flex-1 flex-col items-center px-4">
      <div className="flex w-full max-w-2xl flex-1 flex-col py-8">
        <AuthHeader />
        <ModeToggle mode={mode} setMode={setMode} />
        <Disclaimer />
        {mode === "advisor" && <AdvisorPanel />}
        {mode === "stock" && <StockPanel />}
        {mode === "watchlist" && <WatchlistPanel />}
      </div>
    </div>
  );
}
