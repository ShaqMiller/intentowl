"use client";

/**
 * Monthly / yearly switch and the two plan cards.
 *
 * The only client state on the pricing section. Both checkout links are
 * resolved on the server and passed in; this just chooses which one each
 * card's button points at, so checkout behaves exactly as before.
 */
import { useState } from "react";

import type { Tier } from "../../src/plans.ts";

export interface PlanCard {
  tier: Tier;
  name: string;
  monthly: number;
  annual: number;
  searches: number;
  features: string[];
  links: { monthly: string | undefined; annual: string | undefined };
}

type Period = "monthly" | "annual";

export function PlanToggle({ plans }: { plans: PlanCard[] }) {
  const [period, setPeriod] = useState<Period>("monthly");

  return (
    <>
      <div className="plan-toggle" role="group" aria-label="Billing period">
        <button type="button" aria-pressed={period === "monthly"} onClick={() => setPeriod("monthly")}>
          Monthly
        </button>
        <button type="button" aria-pressed={period === "annual"} onClick={() => setPeriod("annual")}>
          Yearly · 2 months free
        </button>
      </div>

      <div className="plans">
        {plans.map((plan) => {
          const pro = plan.tier === "pro";
          const link = plan.links[period];
          const price = period === "monthly" ? plan.monthly : plan.annual;

          return (
            <div className={pro ? "plan plan-pro" : "plan"} key={plan.tier}>
              <div className="plan-top">
                <span className="plan-name">{plan.name}</span>
                {pro && <span className="plan-pill">Up to {plan.searches} searches</span>}
              </div>
              <p className="plan-price">
                <span className="amount">${price}</span>
                <span className="per">/{period === "monthly" ? "month" : "year"}</span>
              </p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              {link === undefined ? (
                <span className="btn btn-block" aria-disabled="true">
                  Opening shortly
                </span>
              ) : (
                <a className={pro ? "btn btn-dark btn-block" : "btn btn-block"} href={link}>
                  Start 7-day free trial
                </a>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
