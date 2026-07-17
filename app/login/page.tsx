"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PERKS = [
  "Unlimited Finance Advisor chat",
  "5 stock research requests/day, free",
  "Your risk profile is remembered next time you log in",
  "Upgrade any time for unlimited research",
];

const MIN_PASSWORD_LENGTH = 8;

// After login, copy the signup-time name from auth metadata into the profiles row if it's not
// there yet — covers both the immediate-session and email-confirmation-required signup paths.
async function syncProfileName(supabase: ReturnType<typeof createClient>, userId: string, metaName?: string) {
  if (!metaName) return;
  try {
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    if (!profile?.full_name) {
      await supabase.from("profiles").upsert({ id: userId, full_name: metaName });
    }
  } catch {
    // Client-side only — never log Supabase error detail to the browser console. A failed name
    // sync just means the display name fills in on a later visit instead.
  }
}

// A profile counts as "complete" once the person has at least a name and an address on file —
// financial fields are optional and fill in organically through chat.
async function isProfileComplete(supabase: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, address")
      .eq("id", userId)
      .maybeSingle();
    return Boolean(profile?.full_name && profile?.address);
  } catch {
    // Client-side only — never log Supabase error detail to the browser console.
    return true; // never trap a user on a Supabase hiccup
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (mode === "signup") {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Please write a minimum of ${MIN_PASSWORD_LENGTH} characters for your password.`);
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoading(true);

    const supabase = createClient();
    const { data, error } =
      mode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName.trim() } },
          })
        : await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase's raw message here is just "Email not confirmed" — doesn't tell the user what
      // to do about it, and the confirmation email can be slow to arrive (or lost) since this
      // project uses Supabase's shared, rate-limited default sender rather than custom SMTP.
      setError(
        mode === "login" && error.message.toLowerCase().includes("email not confirmed")
          ? "Please confirm your email before logging in — check your inbox (and spam folder) for the confirmation link from your signup. It can take a few minutes to arrive."
          : error.message
      );
      setLoading(false);
      return;
    }

    if (mode === "signup") {
      if (data.session && data.user) {
        await syncProfileName(supabase, data.user.id, fullName.trim());
      }
      setMessage("Account created. Check your email if confirmation is required, then log in.");
      setMode("login");
      setLoading(false);
      return;
    }

    if (data.user) {
      await syncProfileName(supabase, data.user.id, data.user.user_metadata?.full_name);
      const complete = await isProfileComplete(supabase, data.user.id);
      router.push(complete ? "/chat" : "/profile");
      router.refresh();
      return;
    }

    router.push("/chat");
    router.refresh();
  }

  return (
    <div className="glow-field flex flex-1 flex-col">
      <nav className="mx-auto w-full max-w-5xl px-6 py-6">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="neon-heading">AI Finance Advisor</span>
        </Link>
      </nav>

      <div className="mx-auto grid w-full max-w-4xl flex-1 items-center gap-12 px-6 py-12 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {mode === "login" ? (
              <>
                Welcome <span className="neon-heading">back</span>
              </>
            ) : (
              <>
                Get started, <span className="neon-heading">it&apos;s free</span>
              </>
            )}
          </h1>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            No card required to sign up. Here&apos;s what you get:
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {PERKS.map((p) => (
              <li key={p} className="flex items-start gap-2 text-[var(--text-secondary)]">
                <span className="mt-1 text-neon-green">▸</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={handleSubmit} className="glass-card flex flex-col gap-4 p-8">
          <h2 className="text-xl font-bold">{mode === "login" ? "Log in" : "Sign up"}</h2>

          {mode === "signup" && (
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              maxLength={120}
              className="input-neon px-4 py-3 text-sm"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="input-neon px-4 py-3 text-sm"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? `Password (min. ${MIN_PASSWORD_LENGTH} characters)` : "Password"}
            className="input-neon px-4 py-3 text-sm"
          />
          {mode === "signup" && (
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Retype password"
              className="input-neon px-4 py-3 text-sm"
            />
          )}

          {error && <p className="text-sm text-neon-pink">{error}</p>}
          {message && <p className="text-sm text-neon-green">{message}</p>}

          <button type="submit" disabled={loading} className="btn-neon px-6 py-3 text-sm">
            {loading ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
              setMessage(null);
            }}
            className="text-sm text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
          >
            {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
