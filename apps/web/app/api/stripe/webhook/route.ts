/**
 * Stripe webhook endpoint (ARCHITECTURE.md section 4.7).
 *
 * Thin on purpose: verify the signature, hand the event to a pure-ish
 * processor, answer 200. Everything that can be tested without a server lives
 * in `src/stripe.ts`.
 *
 * Two rules this route exists to enforce:
 *
 * 1. **Never trust the body.** Anyone can POST here. The Stripe signature is
 *    the only thing separating a real payment from someone granting themselves
 *    a free account, so an unverifiable request is rejected before it reaches
 *    any database code.
 * 2. **Answer 200 for anything we are not going to act on.** Stripe retries
 *    non-2xx responses for days; a 500 on an event we never handle would be a
 *    self-inflicted retry storm.
 */
import { createDb } from "@intentowl/db";
import { NextResponse } from "next/server";
import Stripe from "stripe";

import { env } from "../../../../src/env.ts";
import { processStripeEvent } from "../../../../src/stripe.ts";

// The raw body is required for signature verification, so this route can never
// be statically optimised or have its body parsed for us.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  if (env.STRIPE_SECRET_KEY === undefined || env.STRIPE_WEBHOOK_SECRET === undefined) {
    // Misconfiguration, not a client error. 500 is correct here: Stripe should
    // retry once the deployment is fixed rather than dropping the event.
    console.error("stripe webhook hit but STRIPE_* env vars are not set");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (signature === null) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const body = await request.text();

  let event: Stripe.Event;
  try {
    // Verifies both the HMAC and the timestamp, so a replayed old payload is
    // rejected as well as a forged one.
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    // 400, never 500: a bad signature is a client error and must not be
    // retried. Retrying a forgery forever would be the worst of both.
    console.warn(
      `stripe signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const { pool, db } = createDb(env.DATABASE_URL ?? "");
  try {
    const outcome = await processStripeEvent(db, event);
    console.info(
      `stripe ${event.type} -> ${outcome.status}` +
        ("customerId" in outcome ? ` (${outcome.customerId})` : ""),
    );
    return NextResponse.json({ received: true, outcome: outcome.status });
  } catch (error) {
    // A genuine failure on our side. 500 so Stripe retries: the alternative is
    // a paid customer who never got a row.
    console.error("stripe webhook processing failed", error);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  } finally {
    await pool.end();
  }
}
