import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeAdvisorCall, VapiError } from "@/lib/vapi";

// Free for every signed-in user (no Pro gate) — a real phone call still costs real money
// regardless of who triggers it, so this daily cap per account is the only cost safety net left.
const MAX_CALLS_PER_DAY = 3;

interface CallRequestBody {
  context?: "general" | "alert";
  alertId?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Log in to call the AI Advisor." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_number, phone_verified, risk_tolerance, goal")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.phone_verified || !profile.phone_number) {
    return NextResponse.json(
      { error: "Verify a phone number on your profile before calling the AI Advisor." },
      { status: 400 }
    );
  }

  let body: CallRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }
  const context: "general" | "alert" = body.context === "alert" ? "alert" : "general";

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("call_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("requested_at", since);
  if ((count ?? 0) >= MAX_CALLS_PER_DAY) {
    return NextResponse.json(
      { error: `You can request up to ${MAX_CALLS_PER_DAY} AI Advisor calls per day.` },
      { status: 429 }
    );
  }

  let alertId: string | null = null;
  let contextBrief: string;

  if (context === "alert") {
    if (!body.alertId) {
      return NextResponse.json({ error: "Missing alertId." }, { status: 400 });
    }
    // RLS (alerts_select_own) already scopes this to the caller's own row; the explicit
    // .eq("user_id", ...) is defense in depth, matching 6.8 everywhere else in the app.
    const { data: alert } = await supabase
      .from("alerts")
      .select("id, symbol, message")
      .eq("id", body.alertId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!alert) {
      return NextResponse.json({ error: "Alert not found." }, { status: 404 });
    }
    alertId = alert.id;
    contextBrief =
      `The caller has a watchlist alert that just fired for ${alert.symbol}: "${alert.message}" ` +
      "Discuss what this could plausibly mean and answer their questions about it.";
  } else {
    const parts: string[] = [];
    if (profile.risk_tolerance) parts.push(`risk tolerance: ${profile.risk_tolerance}`);
    if (profile.goal) parts.push(`stated goal: ${profile.goal}`);
    contextBrief = parts.length
      ? `The caller's known profile — ${parts.join(", ")}. Use this only as context; ask what's on their mind.`
      : "No stored profile yet for this caller — ask what's on their mind.";
  }

  // Insert via the normal authenticated client (not admin) so RLS's `with check (auth.uid() =
  // user_id)` is a real guarantee here, not just a comment — a bug in this route could never
  // insert a call_attempts row under someone else's user_id. The follow-up status update below
  // has to use the admin client instead, since call_attempts deliberately has no update-own policy.
  const { data: attemptRow, error: insertError } = await supabase
    .from("call_attempts")
    .insert({ user_id: user.id, context, alert_id: alertId, status: "requested" })
    .select("id")
    .single();
  if (insertError || !attemptRow) {
    console.error("call_attempts insert error:", insertError);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  const admin = createAdminClient();
  try {
    const call = await placeAdvisorCall(profile.phone_number, contextBrief);
    await admin.from("call_attempts").update({ vapi_call_id: call.id, status: "ringing" }).eq("id", attemptRow.id);
  } catch (err) {
    console.error("placeAdvisorCall error:", err);
    await admin.from("call_attempts").update({ status: "failed" }).eq("id", attemptRow.id);
    const message =
      err instanceof VapiError ? "Couldn't place the call. Please try again." : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
