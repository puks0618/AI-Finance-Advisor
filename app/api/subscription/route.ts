import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSubscriptionStatus,
  isPro,
  countResearchRequestsToday,
  FREE_RESEARCH_DAILY_LIMIT,
} from "@/lib/subscription";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ status: null, remainingToday: null });
  }

  const status = await getSubscriptionStatus(supabase, user.id);
  const userIsPro = isPro(status);
  const remainingToday = userIsPro
    ? null
    : Math.max(0, FREE_RESEARCH_DAILY_LIMIT - (await countResearchRequestsToday(supabase, user.id)));

  return NextResponse.json({ status, remainingToday, dailyLimit: FREE_RESEARCH_DAILY_LIMIT });
}
