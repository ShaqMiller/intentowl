/**
 * Session refresh middleware.
 *
 * Access tokens are short-lived. Server Components cannot write cookies, so
 * without this every refreshed token would be discarded and users would be
 * logged out at random — the single most common way to get Supabase SSR wrong.
 *
 * Two rules the Supabase docs are emphatic about, and both are load-bearing:
 *
 *   1. `getClaims()` (or `getUser()`) must be called here. It is what triggers
 *      the refresh; without it this function does nothing useful.
 *   2. The response object must be the one returned. Constructing a fresh
 *      `NextResponse` later would drop the refreshed cookies.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Read straight from `process.env` rather than the app's Zod-parsed env.
 *
 * That module reaches the repo-root .env through node:fs, and middleware runs
 * in the Edge runtime where there is no filesystem — importing it here fails
 * the build. next.config.ts inlines these two values for exactly this reason.
 * An empty string is what the config emits when a variable is unset.
 */
function config(): { url: string; anonKey: string } | null {
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];
  if (url === undefined || url === "") return null;
  if (anonKey === undefined || anonKey === "") return null;
  return { url, anonKey };
}

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  // Not configured yet: pass the request straight through rather than 500 the
  // whole site. The dashboard's own guard is what refuses access.
  const settings = config();
  if (settings === null) return response;
  const { url, anonKey } = settings;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // A response that sets auth cookies must never be cached by a CDN, or
        // one user's session token gets served to somebody else. The library
        // hands us the exact headers for that.
        for (const [key, headerValue] of Object.entries(headers)) {
          response.headers.set(key, headerValue);
        }
      },
    },
  });

  // Refreshes the token if needed. Do not remove.
  await supabase.auth.getUser();

  return response;
}
