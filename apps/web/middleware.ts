import type { NextRequest } from "next/server";

import { updateSession } from "./src/supabase/middleware.ts";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /**
     * Every path except static assets and the Stripe webhook.
     *
     * Broad on purpose: a path the middleware skips is a path where a token
     * refresh is silently dropped, which shows up as a random logout much
     * later and is miserable to trace back.
     *
     * The webhook is excluded because it is a server-to-server POST carrying a
     * signature, with no session and no cookies to refresh — running auth
     * middleware on it would be pure latency on the one request Stripe retries
     * if it is slow.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
