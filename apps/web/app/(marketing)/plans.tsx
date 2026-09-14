/**
 * The two plan cards, shared by the landing page and /signup so the prices
 * and promises cannot drift between them.
 *
 * Both cards lead with the monthly price and the trial; annual is a quiet link
 * underneath. Most people start monthly on a product they have not tried, and
 * a toggle would make every visitor do a decision the trial exists to defer.
 */
import { checkout } from "../../src/checkout.ts";
import { TIERS, type Tier } from "../../src/plans.ts";

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
  return (
    <>
      <div className="plans">
        {(["starter", "pro"] as const).map((tier) => {
          const info = TIERS[tier];
          const links = checkout[tier];
          const entry = tier === "starter";

          return (
            <div className={entry ? "plan featured" : "plan"} key={tier}>
              <div className="plan-top">
                <span className="plan-name">{info.name}</span>
                <span className="plan-save">
                  {info.searches === 1 ? "1 SEARCH" : `${info.searches} SEARCHES`}
                </span>
              </div>
              <p className="plan-price">
                ${info.monthly}
                <span> /month</span>
              </p>
              <ul>
                {FEATURES[tier].map((feature) => (
                  <PlanItem key={feature}>{feature}</PlanItem>
                ))}
              </ul>
              {links.monthly === undefined ? (
                <span className="btn" aria-disabled="true" style={{ opacity: 0.5 }}>
                  Opening shortly
                </span>
              ) : (
                <a className={entry ? "btn btn-primary" : "btn"} href={links.monthly}>
                  Start 7-day free trial
                </a>
              )}
              {links.annual !== undefined && (
                <a className="plan-alt" href={links.annual}>
                  Or ${info.annual}/year — two months free
                </a>
              )}
            </div>
          );
        })}
      </div>
      <p className="plan-note" style={{ marginTop: 18 }}>
        Free for 7 days, then billed. A card is required to start; cancel before
        day 7 and you are never charged.
      </p>
    </>
  );
}

function PlanItem({ children }: { children: string }) {
  return (
    <li>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 8.5 6.2 11.6 13 4.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}
