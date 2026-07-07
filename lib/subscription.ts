import type { SupabaseClient } from "@supabase/supabase-js";

export type SubscriptionStatus = "free" | "active" | "past_due" | "canceled";

export function isPro(status: SubscriptionStatus): boolean {
  return status === "active";
}

export async function getSubscriptionStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<SubscriptionStatus> {
  const { data } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.status as SubscriptionStatus | undefined) ?? "free";
}

export const FREE_RESEARCH_DAILY_LIMIT = 5;

export async function countResearchRequestsToday(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("research_requests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  return count ?? 0;
}
