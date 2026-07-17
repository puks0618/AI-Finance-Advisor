"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// The landing page itself is a Server Component (mostly static marketing content), so this is
// split out as the one client-rendered piece of its nav — mirrors the same auth check AuthHeader
// does on /chat, just without the Pro badge/profile-name lookups a marketing page doesn't need.
export default function NavAuthLink() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setLoggedIn(!!data.user);
      setChecked(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session?.user);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  if (!checked) return null;

  if (loggedIn) {
    return (
      <>
        <Link href="/chat" className="btn-ghost px-4 py-2 font-medium hover:text-[var(--text-primary)]">
          Go to app
        </Link>
        <button onClick={handleLogout} className="underline hover:text-[var(--text-primary)]">
          Log out
        </button>
      </>
    );
  }

  return (
    <Link href="/login" className="btn-ghost px-4 py-2 font-medium hover:text-[var(--text-primary)]">
      Log in
    </Link>
  );
}
