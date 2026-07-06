import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses Row-Level Security entirely. Only use this from trusted
// server-only code where the target row is identified by data Supabase/Stripe itself signed
// (e.g. a verified Stripe webhook event), never from a value a client could supply directly.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
