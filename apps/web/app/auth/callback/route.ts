/**
 * Where Supabase email links land: confirmations and password resets.
 *
 * The link carries a one-time `code`; exchanging it is what creates the
 * session cookie. Until that exchange happens the user is not signed in, which
 * is exactly what makes the account claim in session.ts safe — it proves they
 * control the inbox.
 *
 * The `next` parameter decides where they end up afterwards, and it is
 * validated rather than trusted: an unchecked redirect target in an emailed
 * URL is an open redirect, and open redirects in auth emails are how phishing
 * links borrow your domain's credibility.
 */
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "../../../src/supabase/server.ts";
import { authConfigured } from "../../../src/session.ts";

export const dynamic = "force-dynamic";

/** Only same-origin paths, and only ones we actually route. */
function safeNext(raw: string | null): string {
  if (raw === null) return "/dashboard";
  // Must be a root-relative path. `//evil.com` is protocol-relative and would
  // leave the site, so a leading double slash is rejected too.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  if (!/^\/(dashboard|login)(\/|$|\?)/.test(raw)) return "/dashboard";
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!authConfigured() || code === null) {
    return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error !== null) {
    // Expired or already-used links are the common case, not an attack.
    return NextResponse.redirect(new URL("/login?error=expired", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
