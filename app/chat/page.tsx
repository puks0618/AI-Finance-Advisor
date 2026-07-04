"use client";

import { useState, type FormEvent } from "react";

interface Message {
  role: "user" | "model";
  text: string;
}

export default function ChatPage() {
  const [mode, setMode] = useState<"advisor" | "stock">("advisor");
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
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col py-8">
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
            disabled
            title="Stock research ships in Phase 2"
            className="cursor-not-allowed rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600"
          >
            Stock Research (coming soon)
          </button>
        </div>

        <p className="mb-4 rounded-lg bg-zinc-100 px-4 py-3 text-xs leading-5 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          This is a research and education tool, not a licensed financial advisor. It won&apos;t tell
          you to buy or sell anything — for major financial decisions, consult a qualified
          professional.
        </p>

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
      </div>
    </div>
  );
}
