"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

interface ProfileForm {
  full_name: string;
  address: string;
  income: string;
  expenses: string;
  debt: string;
  risk_tolerance: "conservative" | "moderate" | "aggressive";
  goal: string;
  preference: string;
}

const EMPTY_FORM: ProfileForm = {
  full_name: "",
  address: "",
  income: "",
  expenses: "",
  debt: "",
  risk_tolerance: "moderate",
  goal: "",
  preference: "",
};

function PhoneVerification({
  initialPhoneNumber,
  initialVerified,
}: {
  initialPhoneNumber: string | null;
  initialVerified: boolean;
}) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber ?? "");
  const [verified, setVerified] = useState(initialVerified);
  const [step, setStep] = useState<"idle" | "code-sent">("idle");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSendCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setStep("code-sent");
      setInfo("Calling you now — enter the code you hear.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/phone/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
      setVerified(true);
      setStep("idle");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card flex flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">Phone (for AI calls)</h2>
        {verified && (
          <span className="rounded-full border border-[var(--border-strong)] px-3 py-1 text-xs font-semibold text-neon-green">
            Verified
          </span>
        )}
      </div>

      {verified ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-primary)]">{phoneNumber}</p>
          <button
            type="button"
            onClick={() => {
              setVerified(false);
              setStep("idle");
            }}
            className="text-xs text-neon-pink hover:underline"
          >
            Change number
          </button>
        </div>
      ) : step === "idle" ? (
        <form onSubmit={handleSendCode} className="flex gap-2">
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+15551234567"
            className="input-neon flex-1 px-4 py-3 text-sm"
          />
          <button type="submit" disabled={loading || !phoneNumber.trim()} className="btn-neon px-6 py-3 text-sm">
            {loading ? "Calling…" : "Send code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
            maxLength={6}
            className="input-neon flex-1 px-4 py-3 text-sm"
          />
          <button type="submit" disabled={loading || !code.trim()} className="btn-neon px-6 py-3 text-sm">
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {info && <p className="text-xs text-neon-cyan">{info}</p>}
      {error && <p className="text-xs text-neon-pink">{error}</p>}
      <p className="text-xs text-[var(--text-muted)]">
        We call this number to confirm it&apos;s really yours before the AI Advisor can ever call it.
      </p>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.push("/login");
        return;
      }
      setUser(data.user);

      const [{ data: profile }, subRes] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle(),
        fetch("/api/subscription").then((r) => r.json()),
      ]);

      setForm({
        full_name: profile?.full_name ?? data.user.user_metadata?.full_name ?? "",
        address: profile?.address ?? "",
        income: profile?.income?.toString() ?? "",
        expenses: profile?.expenses?.toString() ?? "",
        debt: profile?.debt?.toString() ?? "",
        risk_tolerance: profile?.risk_tolerance ?? "moderate",
        goal: profile?.goal ?? "",
        preference: profile?.preference ?? "",
      });
      setPhoneNumber(profile?.phone_number ?? null);
      setPhoneVerified(profile?.phone_verified ?? false);
      setSubscriptionStatus(subRes.status);
      setChecked(true);
    });
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const { error: upsertError } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: form.full_name.trim() || null,
      address: form.address.trim() || null,
      income: form.income ? Number(form.income) : null,
      expenses: form.expenses ? Number(form.expenses) : null,
      debt: form.debt ? Number(form.debt) : null,
      risk_tolerance: form.risk_tolerance,
      goal: form.goal.trim() || null,
      preference: form.preference.trim() || null,
      updated_at: new Date().toISOString(),
    });

    setLoading(false);
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setSaved(true);
  }

  if (!checked) return null;

  const isPro = subscriptionStatus === "active";

  return (
    <div className="glow-field flex flex-1 flex-col">
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="neon-heading">AI Finance Advisor</span>
        </Link>
        <Link href="/chat" className="btn-ghost px-4 py-2 text-sm font-medium">
          Back to app
        </Link>
      </nav>

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-24">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Your <span className="neon-heading">profile</span>
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            This is what the Finance Advisor remembers about you. Nothing here is shared or used
            for anything beyond tailoring your own guidance.
          </p>
        </div>

        <div className="glass-card mb-6 flex items-center justify-between p-5">
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Signed in as</p>
            <p className="font-medium">{user?.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                isPro
                  ? "border-[var(--border-strong)] text-neon-green"
                  : "border-[var(--border-subtle)] text-[var(--text-secondary)]"
              }`}
            >
              {isPro ? "PRO" : "FREE"}
            </span>
            <Link href="/pricing" className="text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Manage plan
            </Link>
          </div>
        </div>

        <div className="mb-6">
          <PhoneVerification initialPhoneNumber={phoneNumber} initialVerified={phoneVerified} />
        </div>

        <form onSubmit={handleSubmit} className="glass-card flex flex-col gap-5 p-8">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Full name</label>
            <input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Your name"
              maxLength={120}
              className="input-neon px-4 py-3 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Street, city, state, ZIP"
              maxLength={300}
              rows={2}
              className="input-neon px-4 py-3 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Monthly income</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.income}
                onChange={(e) => setForm({ ...form, income: e.target.value })}
                placeholder="$"
                className="input-neon px-4 py-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Monthly expenses</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.expenses}
                onChange={(e) => setForm({ ...form, expenses: e.target.value })}
                placeholder="$"
                className="input-neon px-4 py-3 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[var(--text-secondary)]">Total debt</label>
              <input
                type="number"
                min="0"
                step="any"
                value={form.debt}
                onChange={(e) => setForm({ ...form, debt: e.target.value })}
                placeholder="$"
                className="input-neon px-4 py-3 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Risk tolerance</label>
            <select
              value={form.risk_tolerance}
              onChange={(e) => setForm({ ...form, risk_tolerance: e.target.value as ProfileForm["risk_tolerance"] })}
              className="input-neon px-4 py-3 text-sm"
            >
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
            <p className="text-xs text-[var(--text-muted)]">
              Used to tailor stock research briefs when you don&apos;t specify one.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Primary goal</label>
            <input
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              placeholder="e.g. Save for a house down payment"
              maxLength={200}
              className="input-neon px-4 py-3 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--text-secondary)]">Preferences / notes</label>
            <textarea
              value={form.preference}
              onChange={(e) => setForm({ ...form, preference: e.target.value })}
              placeholder="Anything else the advisor should keep in mind"
              maxLength={500}
              rows={3}
              className="input-neon px-4 py-3 text-sm"
            />
          </div>

          {error && <p className="text-sm text-neon-pink">{error}</p>}
          {saved && <p className="text-sm text-neon-green">Saved.</p>}

          <button type="submit" disabled={loading} className="btn-neon px-6 py-3 text-sm">
            {loading ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
