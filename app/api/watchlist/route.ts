import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateTicker, GuardrailError } from "@/lib/guardrails";
import { isAlertCondition, MAX_WATCHLIST_ITEMS_PER_USER } from "@/lib/watchlist";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Log in to use the watchlist." }, { status: 401 });
  }

  const [{ data: watchlist }, { data: alerts }] = await Promise.all([
    supabase.from("watchlist").select("id, symbol, condition, created_at").order("created_at", { ascending: false }),
    supabase
      .from("alerts")
      .select("id, symbol, condition, message, triggered_at")
      .order("triggered_at", { ascending: false })
      .limit(20),
  ]);

  return NextResponse.json({ watchlist: watchlist ?? [], alerts: alerts ?? [] });
}

interface WatchlistRequestBody {
  symbol?: string;
  condition?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Log in to use the watchlist." }, { status: 401 });
  }

  let body: WatchlistRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  let symbol: string;
  try {
    symbol = validateTicker(body.symbol ?? "");
  } catch (err) {
    if (err instanceof GuardrailError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (!isAlertCondition(body.condition)) {
    return NextResponse.json({ error: "Please choose a valid alert condition." }, { status: 400 });
  }

  // 6.4 — a hard per-account cap keeps the cron job's Finnhub call volume bounded regardless of
  // how many users sign up; this is a rate-limit safeguard, not a meaningful product restriction.
  const { count } = await supabase
    .from("watchlist")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_WATCHLIST_ITEMS_PER_USER) {
    return NextResponse.json(
      { error: `You can watch up to ${MAX_WATCHLIST_ITEMS_PER_USER} ticker/condition pairs at a time.` },
      { status: 400 }
    );
  }

  // 6.8 — user_id always comes from the authenticated session, never a client-supplied value.
  const { data, error } = await supabase
    .from("watchlist")
    .insert({ user_id: user.id, symbol, condition: body.condition })
    .select("id, symbol, condition, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "You're already watching that ticker for that condition." }, { status: 409 });
    }
    console.error("watchlist insert error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ watchlistItem: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Log in to use the watchlist." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing watchlist item id." }, { status: 400 });
  }

  // Scoped by user_id in the query itself (defense in depth) in addition to RLS (6.8) — a user
  // can only ever delete their own row either way.
  const { error } = await supabase.from("watchlist").delete().eq("id", id).eq("user_id", user.id);
  if (error) {
    console.error("watchlist delete error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
