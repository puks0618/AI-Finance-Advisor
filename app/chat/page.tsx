"use client";

import { useState, useEffect, type FormEvent } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

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

interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
}

interface StockResult {
  symbol: string;
  quote: Quote | null;
  patterns: DetectedPattern[];
  news: NewsItem[];
  brief: string;
  dataDelayed: boolean;
}

const DISCLAIMER = (
  <p className="mb-4 rounded-lg bg-zinc-100 px-4 py-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
    This is a research and education tool, not a licensed financial advisor. It won&apos;t tell you
    to buy or sell anything — for major financial decisions, consult a qualified professional.
  </p>
);

function ModeToggle({ mode, setMode }: { mode: "advisor" | "stock"; setMode: (m: "advisor" | "stock") => void }) {
  return (
    <div className="mb-4 flex gap-2">
      <button
        type="button"
        onClick={() => setMode("advisor")}
        className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
          mode === "advisor"
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        }`}
      >
        Finance Advisor
      </button>
      <button
        type="button"
        onClick={() => setMode("stock")}
        className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
          mode === "stock"
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        }`}
      >
        Stock Research
      </button>
    </div>
  );
}

function AdvisorPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = input.trim();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Tell me about your income, savings goals, or what&apos;s on your mind financially —
            I&apos;ll ask a few questions before offering any thoughts.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${
              m.role === "user"
                ? "self-end bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "self-start bg-white text-zinc-800 shadow-sm dark:bg-zinc-900 dark:text-zinc-200"
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="self-start rounded-2xl bg-white px-4 py-3 text-sm text-zinc-400 shadow-sm dark:bg-zinc-900">
            Thinking…
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          maxLength={4000}
          className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          Send
        </button>
      </form>
    </>
  );
}

const SIGNAL_STYLES: Record<DetectedPattern["signal"], string> = {
  bullish: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  bearish: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  neutral: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function StockPanel() {
  const [symbol, setSymbol] = useState("");
  const [result, setResult] = useState<StockResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState<"login" | "upgrade" | null>(null);

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
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Ticker symbol, e.g. AAPL"
          maxLength={6}
          className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-3 text-sm uppercase outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={loading || !symbol.trim()}
          className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {loading ? "Researching…" : "Research"}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          <p>{error}</p>
          {gate === "login" && (
            <Link href="/login" className="mt-2 inline-block underline">
              Log in
            </Link>
          )}
          {gate === "upgrade" && (
            <Link href="/pricing" className="mt-2 inline-block underline">
              Upgrade to Pro
            </Link>
          )}
        </div>
      )}

      {!result && !error && !loading && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Enter a ticker to get a price snapshot, detected candlestick patterns, and a plain-English
          research brief tailored to a moderate risk profile. Requires an account; free accounts
          get 5 requests per day.
        </p>
      )}

      {result && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{result.symbol}</h2>
              {result.quote && (
                <span
                  className={
                    result.quote.change >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {result.quote.current.toFixed(2)} ({result.quote.change >= 0 ? "+" : ""}
                  {result.quote.percentChange.toFixed(2)}%)
                </span>
              )}
            </div>
            {result.dataDelayed && (
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                Prices delayed ~15-20 minutes, not real-time.
              </p>
            )}
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
            <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Detected patterns
            </h3>
            {result.patterns.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No notable candlestick patterns in the recent data.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.patterns.map((p, i) => (
                  <li key={i} className="text-sm">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${SIGNAL_STYLES[p.signal]}`}>
                      {p.name}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-300">{p.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-white p-4 text-sm leading-6 whitespace-pre-wrap text-zinc-800 shadow-sm dark:bg-zinc-900 dark:text-zinc-200">
            {result.brief}
          </div>

          {result.news.length > 0 && (
            <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
              <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Recent headlines
              </h3>
              <ul className="flex flex-col gap-2">
                {result.news.map((n, i) => (
                  <li key={i} className="text-sm">
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-800 underline decoration-zinc-300 hover:decoration-zinc-500 dark:text-zinc-200 dark:decoration-zinc-600"
                    >
                      {n.headline}
                    </a>
                    <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">
                      ({n.source})
                    </span>
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

function AuthHeader() {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setChecked(true);
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
    <div className="mb-4 flex items-center justify-end gap-3 text-sm text-zinc-500 dark:text-zinc-400">
      <Link href="/pricing" className="underline hover:text-zinc-700 dark:hover:text-zinc-200">
        Pricing
      </Link>
      {user ? (
        <>
          <span>{user.email}</span>
          <button onClick={handleLogout} className="underline hover:text-zinc-700 dark:hover:text-zinc-200">
            Log out
          </button>
        </>
      ) : (
        <Link href="/login" className="underline hover:text-zinc-700 dark:hover:text-zinc-200">
          Log in to save your profile
        </Link>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [mode, setMode] = useState<"advisor" | "stock">("advisor");

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col py-8">
        <AuthHeader />
        <ModeToggle mode={mode} setMode={setMode} />
        {DISCLAIMER}
        {mode === "advisor" ? <AdvisorPanel /> : <StockPanel />}
      </div>
    </div>
  );
}
