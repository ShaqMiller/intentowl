/**
 * Checkout destinations.
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

/**
 * Plan identifiers. Written into `customers.plan` by the webhook, so they are
 * durable data — renaming one orphans every row already carrying it.
 * Stripe restricts client_reference_id to alphanumerics, `-` and `_`.
 */
export const PLAN_MONTHLY = "founding-monthly";
export const PLAN_ANNUAL = "founding-annual";

function withPlan(link: string | undefined, plan: string): string | undefined {
  if (link === undefined) return undefined;
  const url = new URL(link);
  url.searchParams.set("client_reference_id", plan);
  return url.toString();
}

export const checkout = {
  monthly: withPlan(env.STRIPE_LINK_MONTHLY, PLAN_MONTHLY),
  annual: withPlan(env.STRIPE_LINK_ANNUAL, PLAN_ANNUAL),
};
