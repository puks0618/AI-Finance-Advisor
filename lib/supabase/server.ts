import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server client for Route Handlers and Server Components. Always create a fresh one per
 * request — never share across requests (per @supabase/ssr's own docs).
 *
 * setAll's cache-control `headers` param (added for CDN/proxy safety) is intentionally not
 * applied here: this app has no CDN in front of its API routes, and proxy.ts already owns
 * session-refresh cookie writes on every request, so this client only ever needs to read the
 * session and occasionally write on explicit sign-in/out.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, where cookies can't be set — proxy.ts handles
            // session refresh in that case, so this is safe to ignore.
          }
        },
      },
    }
  );
}
