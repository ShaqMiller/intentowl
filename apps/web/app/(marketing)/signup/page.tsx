/**
 * Sign up.
 *
 * Signing up is starting a trial — there is no account to create first, so
 * this page is a plan choice that hands off to a Stripe Payment Link. Stripe
 * collects the email and the card; the webhook creates the customer row.
 *
 * When the links are not configured it says so rather than rendering a button
 * that goes nowhere.
 */
import type { Metadata } from "next";

import { checkout } from "../../../src/checkout.ts";
import { PlanCards } from "../plans.tsx";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function SignupPage() {
  const ready = Object.values(checkout).some((links) => links.monthly !== undefined);

  return (
    <main className="section signup">
      <div className="page">
        <div className="section-head center">
          <p className="eyebrow">Sign up</p>
          <h2>Pick a plan. The first week is free.</h2>
          <p className="section-sub">
            No account to create first. Checkout takes your email and a card,
            then you tell me what you sell — your first digest lands the next
            morning.
          </p>
        </div>

        {!ready && (
          <div className="notice signup-notice">
            <b>Checkout is opening shortly.</b> The plans below are final; the
            payment links are being switched on. Reply to any conversation you
            have already started with me and I will onboard you manually in the
            meantime.
          </div>
        )}

        <PlanCards />

        <p className="plan-note signup-login">
          Already a customer? <a href="/login">Log in</a>.
        </p>
      </div>
    </main>
  );
}
