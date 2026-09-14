/**
 * Checkout destinations.
 *
 * Four Stripe Payment Links, one per plan and billing interval, each with a
 * 7-day trial that collects a card up front. The trial lives on the link in
 * Stripe, not in code.
 *
 * Payment Links carry no plan information on their own — the webhook only sees
 * a `client_reference_id` if it was appended to the URL the customer clicked.
 * Without it `customers.plan` stays null and the only record of what someone
 * bought lives in Stripe, which is where entitlement bugs come from.
 *
 * One module so there is a single place that decides what a checkout URL looks
 * like, rather than the landing page and the signup page each building one.
 */
import { env } from "./env.ts";
import type { PlanId, Tier } from "./plans.ts";

function withPlan(link: string | undefined, plan: PlanId): string | undefined {
  if (link === undefined) return undefined;
  const url = new URL(link);
  url.searchParams.set("client_reference_id", plan);
  return url.toString();
}

export const checkout: Record<Tier, { monthly: string | undefined; annual: string | undefined }> = {
  starter: {
    monthly: withPlan(env.STRIPE_LINK_STARTER_MONTHLY, "starter-monthly"),
    annual: withPlan(env.STRIPE_LINK_STARTER_ANNUAL, "starter-annual"),
  },
  pro: {
    monthly: withPlan(env.STRIPE_LINK_PRO_MONTHLY, "pro-monthly"),
    annual: withPlan(env.STRIPE_LINK_PRO_ANNUAL, "pro-annual"),
  },
};
