"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function CheckoutBanner() {
  const params = useSearchParams();
  const checkout = params.get("checkout");

  if (checkout === "success") {
    return (
      <div className="glass-card mb-6 px-4 py-3 text-sm text-neon-green">
        Payment received — welcome to Pro! It may take a few seconds for your status to update
        below.
      </div>
    );
  }
  if (checkout === "cancelled") {
    return (
      <div className="glass-card mb-6 px-4 py-3 text-sm text-[var(--text-secondary)]">
        Checkout cancelled — no charge was made.
      </div>
    );
  }
  return null;
}

const COMPARISON: { feature: string; free: string; pro: string }[] = [
  { feature: "Finance Advisor chat", free: "Unlimited", pro: "Unlimited" },
  { feature: "Stock research requests", free: "5 / day", pro: "Unlimited" },
  { feature: "Candlestick pattern detection", free: "✓", pro: "✓" },
  { feature: "Persistent risk profile", free: "✓", pro: "✓" },
  { feature: "Call the AI Advisor", free: "✓", pro: "✓" },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this real financial advice?",
    a: "No. Everything here is framed as research and education, never as a buy/sell instruction. For major financial decisions, talk to a licensed professional.",
  },
  {
    q: "How does the daily free limit work?",
    a: "Free accounts get 5 stock research requests in any rolling 24-hour window. It resets gradually as your oldest requests age past 24 hours — no fixed reset time.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Pro is a standard monthly subscription through Stripe with no lock-in — cancel whenever you like from your Stripe billing portal.",
  },
  {
    q: "Is my payment secure?",
    a: "We never see your card details. Checkout is hosted entirely by Stripe, and this is currently running in Stripe test mode.",
  },
];

export default function PricingPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      setLoggedIn(!!data.user);
      if (data.user) {
        const res = await fetch("/api/subscription");
        const body = await res.json();
        setStatus(body.status);
      }
      setChecked(true);
    });
  }, []);

  async function handleUpgrade() {
    setError(null);
    setUpgrading(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setUpgrading(false);
    }
  }

  const userIsPro = status === "active";

  return (
    <div className="glow-field flex flex-1 flex-col">
      <nav className="mx-auto w-full max-w-5xl px-6 py-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="neon-heading">AI Finance Advisor</span>
        </Link>
      </nav>

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-24">
        <Suspense fallback={null}>
          <CheckoutBanner />
        </Suspense>

        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Simple <span className="neon-heading">pricing</span>
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Start free. Upgrade whenever the daily research cap gets in your way. Cancel anytime.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="glass-card p-6">
            <h2 className="text-lg font-bold">Free</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">$0/month</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
              <li className="flex items-start gap-2">
                <span className="text-neon-green">▸</span>Unlimited Finance Advisor chat
              </li>
              <li className="flex items-start gap-2">
                <span className="text-neon-green">▸</span>5 stock research requests / day
              </li>
              <li className="flex items-start gap-2">
                <span className="text-neon-green">▸</span>Call the AI Advisor
              </li>
            </ul>
          </div>

          <div className="glass-card relative p-6" style={{ borderColor: "var(--border-strong)" }}>
            <span className="absolute -top-3 right-6 rounded-full bg-[var(--bg-base)] px-3 py-1 text-[10px] font-semibold tracking-wide text-neon-green uppercase">
              Most popular
            </span>
            <h2 className="text-lg font-bold">Pro</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">$9.99/month</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
              <li className="flex items-start gap-2">
                <span className="text-neon-green">▸</span>Unlimited Finance Advisor chat
              </li>
              <li className="flex items-start gap-2">
                <span className="text-neon-green">▸</span>Unlimited stock research
              </li>
            </ul>

            {!checked ? null : userIsPro ? (
              <p className="mt-6 rounded-full border border-[var(--border-strong)] px-4 py-2 text-center text-sm font-medium text-neon-green">
                You&apos;re on Pro
              </p>
            ) : loggedIn ? (
              <button onClick={handleUpgrade} disabled={upgrading} className="btn-neon mt-6 w-full py-3 text-sm">
                {upgrading ? "Redirecting…" : "Upgrade to Pro"}
              </button>
            ) : (
              <Link href="/login" className="btn-neon mt-6 flex w-full items-center justify-center py-3 text-sm">
                Log in to upgrade
              </Link>
            )}

            {error && <p className="mt-3 text-sm text-neon-pink">{error}</p>}
          </div>
        </div>

        <div className="glass-card mt-10 overflow-x-auto p-6">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-[var(--text-secondary)]">
                <th className="pb-3 font-medium">Feature</th>
                <th className="pb-3 font-medium">Free</th>
                <th className="pb-3 font-medium text-neon-green">Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.feature} className="border-t border-[var(--border-subtle)]">
                  <td className="py-3 text-[var(--text-primary)]">{row.feature}</td>
                  <td className="py-3 text-[var(--text-secondary)]">{row.free}</td>
                  <td className="py-3 font-medium text-neon-green">{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 flex flex-col gap-4">
          <h2 className="text-xl font-bold">FAQ</h2>
          {FAQ.map((item) => (
            <div key={item.q} className="glass-card p-5">
              <h3 className="font-semibold">{item.q}</h3>
              <p className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">{item.a}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm">
          <Link href="/chat" className="underline text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            Back to the app
          </Link>
        </p>
      </div>
    </div>
  );
}
