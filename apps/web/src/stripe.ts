/**
 * Stripe webhook handling (ARCHITECTURE.md sections 4.7 and 4.8).
 *
 * Payment Links handle the checkout UI, so there is no payment code here at
 * all. What this does is turn a completed checkout into a `customers` row, so
 * that provisioning is a database fact from day one rather than something
 * reconstructed from the Stripe dashboard later.
 *
 * The processing is separated from the HTTP route so it can be tested without
 * a server: signature verification is the security boundary of the whole
 * application, and it deserves tests that do not need a browser.
 */
import { schema, type Db } from "@intentowl/db";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";

export type WebhookOutcome =
  | { status: "ignored"; type: string }
  | { status: "created"; customerId: string; email: string }
  | { status: "updated"; customerId: string; email: string }
  | { status: "churned"; customerId: string };

/**
 * Events we act on. Everything else is acknowledged and dropped.
 *
 * Stripe sends dozens of event types and retries anything not answered with a
 * 2xx. Silently accepting the rest is deliberate: an unrecognised event is not
 * an error, and returning a failure would put Stripe into a retry loop over
 * something we were never going to handle.
 */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.deleted",
  "customer.subscription.updated",
]);

export async function processStripeEvent(
  db: Db,
  event: Stripe.Event,
): Promise<WebhookOutcome> {
  if (!HANDLED.has(event.type)) {
    return { status: "ignored", type: event.type };
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return upsertFromCheckout(db, session);
  }

  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  // A cancelled or lapsed subscription must stop the digest immediately. The
  // scheduler only builds schedules for active customers, so flipping this
  // flag is what actually stops the email going out.
  const active = event.type === "customer.subscription.updated" &&
    ["active", "trialing", "past_due"].includes(subscription.status);

  const rows = await db
    .update(schema.customers)
    .set({ status: active ? "active" : "churned" })
    .where(eq(schema.customers.stripeCustomerId, stripeCustomerId))
    .returning({ id: schema.customers.id });

  const row = rows[0];
  if (row === undefined) {
    // A subscription event for someone we have never seen. Not an error worth
    // retrying — most likely a test event or a customer created outside this
    // flow — so acknowledge it rather than making Stripe retry forever.
    return { status: "ignored", type: event.type };
  }
  return active
    ? { status: "updated", customerId: row.id, email: "" }
    : { status: "churned", customerId: row.id };
}

async function upsertFromCheckout(
  db: Db,
  session: Stripe.Checkout.Session,
): Promise<WebhookOutcome> {
  const email =
    session.customer_details?.email ?? session.customer_email ?? null;
  if (email === null) {
    // Nothing to key on. Acknowledged rather than retried, because a retry
    // would produce exactly the same result.
    return { status: "ignored", type: "checkout.session.completed" };
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : (session.customer?.id ?? null);

  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, email))
    .limit(1);
  const created = existing.length === 0;

  const rows = await db
    .insert(schema.customers)
    .values({
      email,
      name: session.customer_details?.name ?? null,
      status: "active",
      stripeCustomerId,
      // The Payment Link's own reference, so a customer can be traced back to
      // which link they bought through without opening the dashboard.
      plan: session.client_reference_id ?? null,
    })
    .onConflictDoUpdate({
      target: schema.customers.email,
      // Idempotent: Stripe retries webhooks, and the same checkout arriving
      // twice must not create a second customer or reset anything meaningful.
      set: { status: "active", stripeCustomerId },
    })
    .returning({ id: schema.customers.id });

  const row = rows[0];
  if (row === undefined) throw new Error("failed to upsert customer");

  return {
    status: created ? "created" : "updated",
    customerId: row.id,
    email,
  };
}
