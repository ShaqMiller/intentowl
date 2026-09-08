/**
 * Supabase client for the server (ARCHITECTURE.md section 8, M7).
 *
 * `createClient()` acts as the signed-in user, using the anon key and the
 * request's cookies. That is the only client this app needs — including for
 * "sign out everywhere", which `scope: "others"` does on the user's own
 * session. There is deliberately no service-role client here: a client that
 * bypasses row-level security is worth adding only when something genuinely
 * requires it, and nothing does.
 *
 * A new client per request, never a module-level singleton: the client holds
 * that request's cookies, so sharing one would leak one user's session into
 * another's response.
 */
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { env } from "../env.ts";

/** Throws rather than returning a broken client — a silent no-auth client is worse. */
function requireConfig(): { url: string; anonKey: string } {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (url === undefined || anonKey === undefined) {
    throw new Error(
      "Supabase is not configured; set SUPABASE_URL and SUPABASE_ANON_KEY",
    );
  }
  return { url, anonKey };
}

export async function createClient(): Promise<SupabaseClient> {
  const { url, anonKey } = requireConfig();
  const store = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components cannot set cookies; Next throws if you try. That
        // is fine and expected — the middleware refreshes the session and
        // writes the cookies back on every request, so a write attempt from a
        // render is safe to swallow. Swallowing it anywhere the middleware is
        // NOT running would cause silent random logouts, which is why
        // middleware.ts matches every non-asset path.
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          /* called from a Server Component; middleware owns the write */
        }
      },
    },
  });
}
