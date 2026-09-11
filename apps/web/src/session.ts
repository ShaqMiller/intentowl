/**
 * The auth boundary (ARCHITECTURE.md section 8, M7).
 *
 * Everything under /dashboard goes through `requireCustomer`. It resolves the
 * signed-in Supabase user to a row in `customers` — the app's own notion of
 * identity — because an auth user with no customer row has paid for nothing
 * and must not see a dashboard.
 *
 * ## Two identities, joined once
 *
 * Payment creates the customer row (via the Stripe webhook) before any auth
 * user exists. So the first time someone signs in, their auth user is linked
 * to the customer row with the same email and `auth_user_id` is set. After
 * that the link is by id, not by email, so changing either address later does
 * not orphan anything.
 *
 * The claim is safe because Supabase only issues a session for a confirmed
 * email address: to claim a customer row you must control the inbox that the
 * digest is already being sent to. **This depends on email confirmation being
 * enabled in the Supabase project.** With confirmations off, anyone who knows
 * a customer's email could claim their account.
 */
import { schema } from "@intentowl/db";
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getDb } from "./db.ts";
import { env } from "./env.ts";
import { createClient } from "./supabase/server.ts";

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

/** The signed-in auth user, or null. Cheap and cached per request. */
export const getAuthUser = cache(async function getAuthUser(): Promise<{
  id: string;
  email: string;
} | null> {
  if (!authConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null || data.user === null) return null;
  const email = data.user.email;
  if (email === undefined) return null;

  return { id: data.user.id, email };
});

/**
 * Resolve the current customer, or null when nobody is signed in.
 * Callers that require a session should use `requireCustomer`.
 */
export const getCustomer = cache(async function getCustomer(): Promise<SessionCustomer | null> {
  if (!authConfigured()) {
    if (env.NODE_ENV === "production") {
      // Loud in the logs, quiet on the page. Throwing here 500s /login too —
      // and a login page that errors is a worse answer than one that says it
      // is not connected yet. Returning null denies access just as firmly:
      // requireCustomer still throws, so the dashboard stays shut.
      console.error(
        "[session] SUPABASE_URL / SUPABASE_ANON_KEY are not set. Nobody can " +
          "sign in. The dashboard is closed until they are configured.",
      );
      return null;
    }
    return devFallbackCustomer();
  }

  const user = await getAuthUser();
  if (user === null) return null;

  const db = getDb();

  const linked = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.authUserId, user.id))
    .limit(1);

  const row = linked[0] ?? (await claimByEmail(user.id, user.email));
  if (row === undefined) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    plan: row.plan,
    tz: row.tz,
    digestHour: row.digestHour,
    impersonated: false,
  };
});

/**
 * First sign-in: attach this auth user to the unclaimed customer row that
 * shares its email.
 *
 * `isNull(authUserId)` in the WHERE clause is the guard that matters. Without
 * it, a second auth user with the same email — which Supabase should not
 * allow, but which a manual row edit or a future provider merge could produce
 * — would silently steal an account that is already claimed.
 */
async function claimByEmail(authUserId: string, email: string) {
  const db = getDb();

  const claimed = await db
    .update(schema.customers)
    .set({ authUserId })
    .where(
      and(
        eq(schema.customers.email, email),
        isNull(schema.customers.authUserId),
      ),
    )
    .returning();

  return claimed[0];
}

/**
 * The session, or a redirect to the login page.
 *
 * Redirects rather than throws. Next renders a layout and its page
 * concurrently, so the layout's own redirect does not stop the page from
 * running — a page that threw here produced a 500 on the way to a login screen
 * that was already on its way. `redirect()` throws a signal Next understands,
 * which unwinds to the same place without the error.
 */
export async function requireCustomer(): Promise<SessionCustomer> {
  const customer = await getCustomer();
  if (customer === null) {
    redirect("/login");
  }
  return customer;
}

/**
 * Development only: resolve to the first active customer in the database.
 *
 * Only reachable when Supabase is unconfigured AND NODE_ENV is not production.
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
