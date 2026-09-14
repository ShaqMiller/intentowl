/**
 * Plans, and what each one allows.
 *
 * The one limit is how many searches run at once. Starter runs one — and can
 * rewrite it whenever it likes, so changing direction never costs an upgrade.
 * Pro runs three, for a second product, a different audience, or a
 * competitor's unhappy customers alongside the main search.
 *
 * Paused searches do not count. A limit on searches *existing* would make
 * someone delete lead history to try something new; a limit on searches
 * *running* only asks them to pause one.
 *
 * One map, read by the dashboard, the actions and the webhook, so a limit is
 * never an `if` scattered across three files.
 */

export type Tier = "starter" | "pro";

export interface TierInfo {
  tier: Tier;
  name: string;
  /** Searches that may be active at the same time. */
  searches: number;
  /** USD, for display. Stripe holds the prices that are actually charged. */
  monthly: number;
  annual: number;
}

export const TIERS: Record<Tier, TierInfo> = {
  starter: { tier: "starter", name: "Starter", searches: 1, monthly: 15, annual: 150 },
  pro: { tier: "pro", name: "Pro", searches: 3, monthly: 39, annual: 390 },
};

/**
 * Written into `customers.plan`, so these are durable data — renaming one
 * orphans every row already carrying it. Stripe restricts
 * client_reference_id to alphanumerics, `-` and `_`.
 */
export const PLAN_IDS = [
  "starter-monthly",
  "starter-annual",
  "pro-monthly",
  "pro-annual",
] as const;

export type PlanId = (typeof PLAN_IDS)[number];

/**
 * Map a Stripe price lookup key (`starter_monthly`) to a plan id. Used when a
 * subscription changes price outside checkout — a plan switched by hand in
 * the Stripe dashboard, for instance.
 */
export function planFromLookupKey(key: string | null | undefined): PlanId | null {
  if (key === null || key === undefined) return null;
  const id = key.replace("_", "-");
  return (PLAN_IDS as readonly string[]).includes(id) ? (id as PlanId) : null;
}

/**
 * What a stored plan allows.
 *
 * Accounts from before tiers existed — onboarded by hand (null) or on the
 * $49 founding price — keep Pro's limits. They paid more than Pro costs now,
 * and quietly pausing their searches would be a strange thank-you.
 */
export function planInfo(plan: string | null): TierInfo & { legacy: boolean } {
  if (plan?.startsWith("starter-") === true) return { ...TIERS.starter, legacy: false };
  if (plan?.startsWith("pro-") === true) return { ...TIERS.pro, legacy: false };
  return { ...TIERS.pro, name: plan === null ? "Concierge" : "Founding", legacy: true };
}
