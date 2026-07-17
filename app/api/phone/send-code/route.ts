import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { placeVerificationCall, generateVerificationCode, VapiError } from "@/lib/vapi";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const CODE_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

interface SendCodeBody {
  phoneNumber?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Log in to verify a phone number." }, { status: 401 });
  }

  let body: SendCodeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const phoneNumber = (body.phoneNumber ?? "").trim();
  if (!E164_PATTERN.test(phoneNumber)) {
    return NextResponse.json(
      { error: "Enter your number in international format, e.g. +15551234567." },
      { status: 400 }
    );
  }

  // phone_verifications has no client-facing RLS policies at all (by design — see the migration),
  // so every read/write here goes through the admin client, gated by our own auth check above.
  const admin = createAdminClient();

  // Places a real phone call, which costs real Vapi credits — a per-user cooldown keeps a
  // client-side bug or deliberate abuse from placing a rapid burst of calls (6.10-style spirit).
  const { data: existing } = await admin
    .from("phone_verifications")
    .select("created_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    const secondsSinceLast = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
      return NextResponse.json(
        { error: `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast)}s before requesting another code.` },
        { status: 429 }
      );
    }
  }

  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const { error: upsertError } = await admin.from("phone_verifications").upsert({
    user_id: user.id,
    phone_number: phoneNumber,
    code,
    attempts: 0,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  });
  if (upsertError) {
    console.error("phone_verifications upsert error:", upsertError);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  try {
    await placeVerificationCall(phoneNumber, code);
  } catch (err) {
    console.error("placeVerificationCall error:", err);
    const message = err instanceof VapiError ? "Couldn't place the verification call. Please try again." : "Something went wrong. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
