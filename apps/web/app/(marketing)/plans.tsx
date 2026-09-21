/**
 * The two plan cards, shared by the landing page and /signup so the prices
 * and promises cannot drift between them.
 *
 * Server-side on purpose: the checkout links come from env here and are
 * handed to the small client toggle, which only picks monthly or yearly.
 */
import { checkout } from "../../src/checkout.ts";
import { TIERS, type Tier } from "../../src/plans.ts";
import { PlanToggle, type PlanCard } from "./plan-toggle.tsx";

const FEATURES: Record<Tier, string[]> = {
  starter: [
    "One search running — rewrite it whenever you like",
    "A ranked digest every morning at 7am",
    "Every live source included",
    "Rate leads to teach it what good looks like",
  ],
  pro: [
    "Up to three searches running at once",
    "Watch another product, audience or competitor",
    "Everything in Starter",
    "Searches tuned by hand in week one",
  ],
};

export function PlanCards() {
  const plans: PlanCard[] = (["starter", "pro"] as const).map((tier) => ({
    tier,
    name: TIERS[tier].name,
    monthly: TIERS[tier].monthly,
    annual: TIERS[tier].annual,
    searches: TIERS[tier].searches,
    features: FEATURES[tier],
    links: checkout[tier],
  }));

  return (
    <div className="plans-wrap">
      <PlanToggle plans={plans} />
      <p className="plan-note">
        Free for 7 days, then billed. A card is required to start; cancel before
        day 7 and you are never charged.
      </p>
    </div>
  );
}
