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
      <div className="mb-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        Payment received — welcome to Pro! It may take a few seconds for your status to update
        below.
      </div>
    );
  }
  if (checkout === "cancelled") {
    return (
      <div className="mb-6 rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        Checkout cancelled — no charge was made.
      </div>
    );
  }
  return null;
}

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
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <div className="w-full max-w-2xl">
        <Suspense fallback={null}>
          <CheckoutBanner />
        </Suspense>

        <h1 className="mb-8 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Pricing</h1>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Free</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">$0/month</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <li>Unlimited Finance Advisor chat</li>
              <li>5 stock research requests / day</li>
            </ul>
          </div>

          <div className="rounded-2xl border-2 border-zinc-900 bg-white p-6 shadow-sm dark:border-zinc-50 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Pro</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">$9.99/month</p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <li>Unlimited Finance Advisor chat</li>
              <li>Unlimited stock research</li>
              <li>Proactive alert calls (coming soon)</li>
            </ul>

            {!checked ? null : userIsPro ? (
              <p className="mt-6 rounded-full bg-emerald-100 px-4 py-2 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                You&apos;re on Pro
              </p>
            ) : loggedIn ? (
              <button
                onClick={handleUpgrade}
                disabled={upgrading}
                className="mt-6 w-full rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900"
              >
                {upgrading ? "Redirecting…" : "Upgrade to Pro"}
              </button>
            ) : (
              <Link
                href="/login"
                className="mt-6 block w-full rounded-full bg-zinc-900 px-6 py-3 text-center text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
              >
                Log in to upgrade
              </Link>
            )}

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </div>

        <p className="mt-8 text-center text-sm">
          <Link href="/chat" className="underline hover:text-zinc-700 dark:hover:text-zinc-200">
            Back to the app
          </Link>
        </p>
      </div>
    </div>
  );
}
