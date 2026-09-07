/**
 * Sign up.
 *
 * Signing up is paying — there is no free tier and no account to create first,
 * so this page is a plan choice that hands off to a Stripe Payment Link.
 * Stripe collects the email; the webhook creates the customer row.
 *
 * When the links are not configured it says so rather than rendering a button
 * that goes nowhere.
 */
import type { Metadata } from "next";

import { checkout } from "../../../src/checkout.ts";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function SignupPage() {
  const monthly = checkout.monthly;
  const annual = checkout.annual;
  const ready = monthly !== undefined || annual !== undefined;

  return (
    <main className="section" style={{ borderTop: 0 }}>
      <div className="page">
        <div className="section-head center">
          <p className="eyebrow">Sign up</p>
          <h2>Pick a plan and I will set you up by hand.</h2>
          <p className="section-sub">
            No account to create first. Checkout takes your email, then you tell
            me what you sell — your first digest lands the next morning.
          </p>
        </div>

        {!ready && (
          <div
            className="notice"
            style={{ maxWidth: 560, margin: "0 auto 26px" }}
          >
            <b>Checkout is opening shortly.</b> The plans below are final; the
            payment links are being switched on. Reply to any conversation you
            have already started with me and I will onboard you manually in the
            meantime.
          </div>
        )}

        <div className="plans">
          <div className="plan featured">
            <div className="plan-top">
              <span className="plan-name">Monthly</span>
            </div>
            <p className="plan-price">
              $49<span> /month</span>
            </p>
            <ul>
              <Item>One ranked digest every morning</Item>
              <Item>Every live source included</Item>
              <Item>Watch tuned by hand in week one</Item>
              <Item>Cancel from any digest</Item>
            </ul>
            {monthly === undefined ? (
              <span className="btn" aria-disabled="true" style={{ opacity: 0.5 }}>
                Opening shortly
              </span>
            ) : (
              <a className="btn btn-primary" href={monthly}>
                Continue to checkout
              </a>
            )}
          </div>

          <div className="plan">
            <div className="plan-top">
              <span className="plan-name">Annual</span>
              <span className="plan-save">SAVE 66%</span>
            </div>
            <p className="plan-price">
              $199<span> /year</span>
            </p>
            <ul>
              <Item>Everything in monthly</Item>
              <Item>Two months of runway instead of twelve</Item>
              <Item>New sources at no extra cost</Item>
              <Item>Price locked for as long as you stay</Item>
            </ul>
            {annual === undefined ? (
              <span className="btn" aria-disabled="true" style={{ opacity: 0.5 }}>
                Opening shortly
              </span>
            ) : (
              <a className="btn" href={annual}>
                Continue to checkout
              </a>
            )}
          </div>
        </div>

        <p className="plan-note" style={{ marginTop: 20 }}>
          Already a customer? <a href="/login">Log in</a>.
        </p>
      </div>
    </main>
  );
}

function Item({ children }: { children: string }) {
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
