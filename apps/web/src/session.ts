/**
 * The auth boundary (ARCHITECTURE.md section 8, M7).
 *
 * Everything under /dashboard goes through `requireCustomer`. It resolves the
 * signed-in user to a row in `customers` — the app's own notion of identity —
 * because an auth user with no customer row has paid for nothing and must not
 * see a dashboard.
 *
 * ## The development fallback
 *
 * Supabase Auth is not wired yet (it needs project keys). Rather than block the
 * whole dashboard on that, a dev-only fallback resolves to the single customer
 * in the database so the UI can be built and reviewed against real data.
 *
 * That fallback is a loaded gun, so it is guarded three ways: it is refused
 * outright when NODE_ENV is production, refused when Supabase *is* configured,
 * and it logs on every use. If you find yourself wanting to relax any of those,
 * wire the real thing instead — an auth bypass that reaches production is not a
 * bug you get to fix afterwards.
 */
import { schema } from "@intentowl/db";
import { eq } from "drizzle-orm";
import { cache } from "react";

import { getDb } from "./db.ts";
import { env } from "./env.ts";

export interface SessionCustomer {
  id: string;
  email: string;
  name: string | null;
  status: "lead" | "active" | "churned";
  plan: string | null;
  tz: string;
  digestHour: number;
  /** True when this session came from the dev fallback rather than real auth. */
  impersonated: boolean;
}

/** Whether real auth is configured. Both halves are required to be useful. */
export function authConfigured(): boolean {
  return env.SUPABASE_URL !== undefined && env.SUPABASE_ANON_KEY !== undefined;
}

/**
 * Resolve the current customer, or null when nobody is signed in.
 * Callers that require a session should use `requireCustomer`.
 *
 * Wrapped in React's `cache` so the layout and the page it wraps share one
 * lookup per request instead of each issuing its own query — the layout always
 * resolves the session, and so does every page inside it.
 */
export const getCustomer = cache(async function getCustomer(): Promise<SessionCustomer | null> {
  if (authConfigured()) {
    // Wired in the same change that adds @supabase/ssr: read the session
    // cookie, then look up customers by auth_user_id. Until then, refusing is
    // the honest answer — pretending to have a session would be worse.
    return null;
  }

  if (env.NODE_ENV === "production") {
    throw new Error(
      "Supabase auth is not configured. The dashboard refuses to serve in " +
        "production without it — set SUPABASE_URL and SUPABASE_ANON_KEY.",
    );
  }

  return devFallbackCustomer();
});

export async function requireCustomer(): Promise<SessionCustomer> {
  const customer = await getCustomer();
  if (customer === null) {
    throw new Error("not signed in");
  }
  return customer;
}

/**
 * Development only: resolve to the first active customer in the database.
 *
 * Picks deterministically (oldest first) so the dashboard shows the same
 * account across reloads rather than shuffling with row order.
 */
async function devFallbackCustomer(): Promise<SessionCustomer | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.status, "active"))
    .orderBy(schema.customers.createdAt)
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  console.warn(
    `[session] DEV FALLBACK: serving the dashboard as ${row.email} with no ` +
      `authentication. This path is refused in production.`,
  );

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    plan: row.plan,
    tz: row.tz,
    digestHour: row.digestHour,
    impersonated: true,
  };
}
