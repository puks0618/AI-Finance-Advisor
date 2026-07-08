import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_ATTEMPTS = 5;

interface VerifyCodeBody {
  code?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Log in to verify a phone number." }, { status: 401 });
  }

  let body: VerifyCodeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const submitted = (body.code ?? "").trim();
  if (!submitted) {
    return NextResponse.json({ error: "Enter the code from the call." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pending } = await admin
    .from("phone_verifications")
    .select("phone_number, code, attempts, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!pending) {
    return NextResponse.json({ error: "Request a new code first." }, { status: 400 });
  }
  if (new Date(pending.expires_at).getTime() < Date.now()) {
    await admin.from("phone_verifications").delete().eq("user_id", user.id);
    return NextResponse.json({ error: "That code expired. Request a new one." }, { status: 400 });
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    await admin.from("phone_verifications").delete().eq("user_id", user.id);
    return NextResponse.json({ error: "Too many incorrect attempts. Request a new code." }, { status: 429 });
  }

  if (submitted !== pending.code) {
    await admin
      .from("phone_verifications")
      .update({ attempts: pending.attempts + 1 })
      .eq("user_id", user.id);
    const remaining = MAX_ATTEMPTS - (pending.attempts + 1);
    return NextResponse.json(
      { error: remaining > 0 ? `That code's not right — ${remaining} attempts left.` : "That code's not right." },
      { status: 400 }
    );
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .upsert({ id: user.id, phone_number: pending.phone_number, phone_verified: true, updated_at: new Date().toISOString() });
  if (profileError) {
    console.error("profiles upsert error (phone verification):", profileError);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  await admin.from("phone_verifications").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
