/**
 * Post-checkout page (ARCHITECTURE.md section 4.7).
 *
 * Stripe redirects here after a successful Payment Link checkout. Its only job
 * is to collect the one thing payment cannot: what the customer actually
 * sells. Without that the pipeline has no profile to classify against, so this
 * page is the difference between a paying customer and a working one.
 *
 * Deliberately does NOT confirm the subscription itself. The webhook is the
 * source of truth for that, and it may land after this page renders — telling
 * someone they are set up before the row exists is how you get a support email
 * you cannot answer.
 */
import type { Metadata } from "next";

import { env } from "../../../src/env.ts";

export const metadata: Metadata = {
  title: "One more thing",
  robots: { index: false },
};

export default function ThanksPage() {
  const form = env.ONBOARDING_FORM_URL;

  return (
    <main className="prose">
      <p className="eyebrow">Payment received</p>
      <h1>Now the part that makes it yours.</h1>
      <p>
        IntentOwl works by reading posts against a description of your product,
        not against a keyword list — so it needs that description before it can
        find you anything. It takes about three minutes and it is the single
        biggest lever on quality.
      </p>

      {form === undefined ? (
        <>
          <p>
            <b>Reply to your Stripe receipt</b> with four things and I will set
            you up by hand, usually the same day:
          </p>
          <ol>
            <li>What your product does, in a paragraph.</li>
            <li>Who your ideal customer is — and who is definitely not.</li>
            <li>Your competitors by name.</li>
            <li>Communities you already know your customers hang out in.</li>
          </ol>
        </>
      ) : (
        <p>
          <a className="btn btn-primary" href={form}>
            Fill in the onboarding form
          </a>
        </p>
      )}

      <p style={{ marginTop: 28 }}>
        Your first digest arrives the morning after setup. If the first week
        looks wrong, reply and say so — tuning the watch by hand is included,
        and honestly it is most of what the first week is for.
      </p>
    </main>
  );
}
