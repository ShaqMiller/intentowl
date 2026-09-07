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
  title: "One more thing — IntentOwl",
  robots: { index: false },
};

export default function ThanksPage() {
  const form = env.ONBOARDING_FORM_URL;

  return (
    <>
      <style>{CSS}</style>
      <main className="wrap">
        <p className="eyebrow">IntentOwl</p>
        <h1>Payment received. Now the part that makes it yours.</h1>
        <p className="lede">
          IntentOwl works by reading posts against a description of your
          product, not against a keyword list — so it needs that description
          before it can find you anything. It takes about three minutes and it
          is the single biggest lever on quality.
        </p>

        {form === undefined ? (
          <div className="fallback">
            <p>
              <b>Reply to your Stripe receipt</b> with four things and I will
              set you up by hand, usually the same day:
            </p>
            <ol>
              <li>What your product does, in a paragraph.</li>
              <li>Who your ideal customer is — and who is definitely not.</li>
              <li>Your competitors by name.</li>
              <li>Communities you already know your customers hang out in.</li>
            </ol>
          </div>
        ) : (
          <p>
            <a className="btn primary" href={form}>
              Fill in the onboarding form
            </a>
          </p>
        )}

        <p className="fine">
          Your first digest arrives the morning after setup. If the first week
          looks wrong, reply and say so — tuning the watch by hand is included,
          and honestly it is most of what the first week is for.
        </p>
      </main>
    </>
  );
}

const CSS = `
:root {
  --ground:#F4F6F7; --surface:#FFFFFF; --ink:#131A20; --ink-soft:#3D4A55;
  --muted:#5F6E7A; --faint:#8695A1; --line:#D9E0E5; --accent:#0E6E78;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground:#0E1418; --surface:#151D23; --ink:#E4ECF1; --ink-soft:#C0CED8;
    --muted:#93A5B1; --faint:#71838F; --line:#26323A; --accent:#45B5C0;
  }
}
* { box-sizing:border-box; }
body {
  margin:0; background:var(--ground); color:var(--ink); line-height:1.6;
  font-family:"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { font-family:"IBM Plex Sans Condensed","IBM Plex Sans",system-ui,sans-serif; font-weight:600; font-size:clamp(26px,4.4vw,38px); margin:0 0 18px; max-width:18ch; text-wrap:balance; line-height:1.18; }
.wrap { max-width:640px; margin:0 auto; padding:64px 24px 80px; }
.eyebrow { font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:0 0 20px; }
.lede { font-size:17px; color:var(--ink-soft); max-width:60ch; }
.btn { display:inline-block; font-size:15px; font-weight:600; padding:11px 22px; border-radius:7px; text-decoration:none; border:1px solid var(--accent); background:var(--accent); color:#fff; margin-top:8px; }
.fallback { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:18px 22px; margin:26px 0; }
.fallback p { margin:0 0 10px; }
.fallback ol { margin:0; padding-left:20px; color:var(--ink-soft); }
.fallback li { margin-bottom:6px; }
.fine { margin-top:28px; font-size:14px; color:var(--muted); max-width:60ch; }
`;
