"use server";

/**
 * Stripe's hosted customer portal: switch between Starter and Pro, update the
 * card, see invoices, cancel at the end of the period. Replaces "reply to any
 * digest and I will do it for you".
 *
 * Nothing here writes to our database. A plan change comes back through the
 * existing webhook (`customer.subscription.updated`), which maps the new
 * price's lookup key to a plan and pauses searches past a smaller plan's
 * limit — the same path a change made in the Stripe dashboard takes.
 *
 * The portal's options (which prices, cancel at period end, no email changes)
 * are a configuration in Stripe, not code; see docs/DEPLOY.md.
 */
import type { Route } from "next";
import { redirect } from "next/navigation";
import Stripe from "stripe";

import { env } from "./env.ts";
import { getStripeCustomerId } from "./queries.ts";
import { requireCustomer } from "./session.ts";

export async function openBillingPortal(): Promise<void> {
  const customer = await requireCustomer();
  const secret = env.STRIPE_SECRET_KEY;
  const stripeCustomerId = await getStripeCustomerId(customer.id);

  if (secret === undefined || stripeCustomerId === null) {
    redirect("/dashboard/settings?billing=unavailable" as Route);
  }

  let url: string;
  try {
    const session = await new Stripe(secret).billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${env.APP_URL}/dashboard/settings`,
    });
    url = session.url;
  } catch (error) {
    // Outside the try: redirect() works by throwing, and must not be caught.
    console.error("billing portal session failed", error);
    redirect("/dashboard/settings?billing=error" as Route);
  }

  redirect(url as Route);
}
