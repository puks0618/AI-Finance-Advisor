import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Vapi's call-status webhook. Configured as the Assistant's `server.url`, with a custom header
 * (checked below) since Vapi doesn't sign payloads the way Stripe does — a shared secret is
 * the equivalent guardrail 6.9-style boundary for this endpoint.
 *
 * Every message type Vapi is configured to send lands here; only "end-of-call-report" is acted
 * on. Everything else gets a 200 with no action, so Vapi doesn't retry a message we don't care
 * about — matches the "cheap, idempotent, no side effects for anything not explicitly handled"
 * shape of the cron endpoint.
 */

interface VapiWebhookMessage {
  type?: string;
  call?: { id?: string };
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return false;
  return request.headers.get("x-vapi-webhook-secret") === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { message?: VapiWebhookMessage };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const message = body.message;
  if (message?.type !== "end-of-call-report" || !message.call?.id) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("call_attempts")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("vapi_call_id", message.call.id);

  if (error) {
    // Logged, not thrown — Vapi doesn't need to know our logging failed, and retrying won't help.
    console.error("vapi-webhook: failed to update call_attempts:", error);
  }

  return NextResponse.json({ ok: true });
}
