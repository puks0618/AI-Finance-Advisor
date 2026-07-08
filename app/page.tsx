import Link from "next/link";

const FEATURES = [
  {
    emoji: "💬",
    title: "Finance Advisor",
    description:
      "A consultative chat that actually asks about your income, debt, and goals before it says anything — then keeps that profile for next time.",
    bullets: [
      "Asks clarifying questions first, never assumes",
      "Plain-English guidance, framed as research — never a command",
      "Remembers your risk profile once you're logged in",
    ],
  },
  {
    emoji: "📈",
    title: "Stock Research",
    description:
      "Deterministic candlestick pattern detection meets an AI that explains what it's looking at, backed by delayed quotes and real headlines.",
    bullets: [
      "6 candlestick patterns detected by code, not guesswork",
      "Live delayed quote + recent headlines per ticker",
      "5 free lookups/day, unlimited on Pro",
    ],
  },
];

const STEPS = [
  { n: "01", title: "Sign up free", body: "No card required. Just an email and password." },
  {
    n: "02",
    title: "Chat or research a ticker",
    body: "Talk finances in plain English, or drop a symbol for a full brief.",
  },
  {
    n: "03",
    title: "Go unlimited on Pro",
    body: "$9.99/mo unlocks unlimited stock research and proactive AI alert calls.",
  },
];

const TRUST_BADGES = ["Research, not advice", "Delayed market data", "PII-aware guardrails"];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-lg font-bold tracking-tight">
          <span className="neon-heading">AI Finance Advisor</span>
        </span>
        <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
          <Link href="/pricing" className="hover:text-[var(--text-primary)]">
            Pricing
          </Link>
          <Link href="/login" className="btn-ghost px-4 py-2 font-medium hover:text-[var(--text-primary)]">
            Log in
          </Link>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-24 px-6 pb-24">
        <section className="glow-field flex flex-col items-center gap-8 pt-16 pb-8 text-center">
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-1.5 text-xs font-medium tracking-wide text-neon-green uppercase">
            Powered by Gemini 3.5
          </span>
          <h1 className="max-w-3xl text-5xl font-extrabold tracking-tight text-balance sm:text-6xl">
            <span className="neon-heading">Money advice</span> that asks questions
            <br />
            before it has opinions.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-[var(--text-secondary)]">
            A consultative AI that gets to know your financial situation first, plus a stock
            research copilot with real candlestick pattern detection — never a buy/sell signal.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/chat" className="btn-neon flex h-12 items-center px-8 text-base">
              Start free
            </Link>
            <Link href="/pricing" className="btn-ghost flex h-12 items-center px-8 text-base font-medium">
              See pricing
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            {TRUST_BADGES.map((b) => (
              <span
                key={b}
                className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-secondary)]"
              >
                {b}
              </span>
            ))}
          </div>
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass-card flex flex-col gap-4 p-8">
              <span className="text-3xl">{f.emoji}</span>
              <h2 className="text-xl font-bold">{f.title}</h2>
              <p className="text-sm leading-6 text-[var(--text-secondary)]">{f.description}</p>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-[var(--text-secondary)]">
                    <span className="mt-1 text-neon-green">▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-8">
          <h2 className="text-center text-2xl font-bold">How it works</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="glass-card flex flex-col gap-2 p-6">
                <span className="font-mono text-sm text-neon-cyan">{s.n}</span>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="text-sm leading-6 text-[var(--text-secondary)]">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-card flex flex-col items-center gap-4 p-10 text-center">
          <h2 className="text-2xl font-bold">Free to start, $9.99/mo for unlimited research</h2>
          <p className="max-w-md text-sm text-[var(--text-secondary)]">
            Free accounts get unlimited chat and 5 stock research requests a day. Pro removes the
            cap and unlocks proactive AI alert calls.
          </p>
          <Link href="/pricing" className="btn-neon flex h-11 items-center px-7 text-sm">
            Compare plans
          </Link>
        </section>

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 py-5 text-center text-xs leading-6 text-[var(--text-muted)]">
          This is a research and education tool, not a licensed financial advisor. It won&apos;t
          tell you to buy or sell anything, market data is delayed 15–20 minutes, and it&apos;s not
          a substitute for professional advice on major financial decisions.
        </section>
      </main>
    </div>
  );
}
