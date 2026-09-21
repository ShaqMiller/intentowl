/**
 * Post-checkout page (ARCHITECTURE.md section 4.7).
 *
 * Stripe redirects here after a Payment Link checkout starts a trial. Its only job
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
import { Owl } from "../../owl.tsx";

export const metadata: Metadata = {
  title: "One more thing",
  robots: { index: false },
};

export default function ThanksPage() {
  const form = env.ONBOARDING_FORM_URL;

  return (
    <main className="thanks">
      <div className="thanks-head">
        <Owl mood="happy" size={120} />
        <p className="thanks-pill">Your 7-day trial has started</p>
        <h1>Now the part that makes it yours.</h1>
      </div>
      <p className="thanks-lede">
        IntentOwl works by reading posts against a description of your product,
        not against a keyword list — so it needs that description before it can
        find you anything. It takes about three minutes and it is the single
        biggest lever on quality.
      </p>

      <ol className="thanks-steps">
        <li>
          <span className="thanks-num">1</span>
          <p>
            <b>Set your password</b> with the email you just used at checkout.
            We send a confirmation link to that address.
          </p>
        </li>
        <li>
          <span className="thanks-num">2</span>
          <p>
            <b>Describe what you sell</b> in a few sentences. IntentOwl drafts
            your profile and search terms from it, and you check every word before
            anything runs. About three minutes.
          </p>
        </li>
      </ol>
      <div className="thanks-cta">
        <a className="btn btn-primary btn-lg" href="/login/claim">
          Set your password
        </a>
      </div>
      {form !== undefined && (
        <p className="thanks-alt">
          Prefer to hand it over? <a href={form}>Fill in the onboarding form</a>{" "}
          and I will set it up for you.
        </p>
      )}

      <p className="thanks-fine">
        Your first digest arrives the morning after setup. If the first week
        looks wrong, reply and say so — tuning the watch by hand is included,
        and honestly it is most of what the first week is for.
      </p>
    </main>
  );
}
