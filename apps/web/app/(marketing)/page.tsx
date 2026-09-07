/**
 * Landing page (ARCHITECTURE.md sections 4.7 and 4.8).
 *
 * One job: convince a founder that they are missing threads where people ask
 * for what they built, and that $49 to stop missing them is obvious. Checkout
 * is a Stripe Payment Link, so there is no payment code in the app at all.
 *
 * Everything claimed here has to be true today. The sources list is the
 * dangerous one — it is tempting to list Reddit because the adapter exists,
 * but it has never run against the live API, and a landing page is a promise.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { checkout } from "../../src/checkout.ts";
import { ScrambleWord } from "./scramble-word.tsx";

export const metadata: Metadata = {
  title: "Never miss someone asking for what you built",
  description:
    "A daily digest of the posts where people describe the problem your product solves, ranked, with an angle for replying. You write the reply.",
};

/**
 * Sources that genuinely poll in production today.
 *
 * Reddit is deliberately absent from `live`: the adapter is built and tested
 * against recorded fixtures but has never touched the live API, and app
 * approval is outstanding. It moves up on the day it actually polls.
 */
const LIVE_SOURCES = ["Hacker News", "Lobsters", "Stack Exchange"];
const NEXT_SOURCES = ["Reddit", "Bluesky", "RSS"];

/** The rotating word in the headline — live sources only, same promise. */
const SCRAMBLE_SOURCES = ["HACKER NEWS", "LOBSTERS", "STACK EXCHANGE"];

const STEPS = [
  {
    title: "You describe what you sell",
    body: "Your product, who it is for, your competitors, and who is definitely not a customer. One paragraph each. This is the part that makes the results yours instead of generic.",
  },
  {
    title: "We read the communities all day",
    body: "Every ten to twenty minutes, across every source. A cheap keyword pass throws out the obvious noise, then Claude reads what survives against your description — not against a keyword list.",
  },
  {
    title: "You get one email at 7am",
    body: "Ranked, grouped, fifteen at most. Each lead carries the post, why it matters to you specifically, and an angle to reply from. Nothing is ever auto-posted.",
  },
];

const FEATURES = [
  {
    mark: "01 · JUDGED",
    title: "It reads the situation, not the keyword",
    body: "“How did you all find your first customers?” never mentions your category, so no alert tool will ever show it to you. It is also the single best thread you could reply to this week.",
  },
  {
    mark: "02 · RANKED",
    title: "Scored, grouped, and capped at fifteen",
    body: "Sorted by how close the person is to buying, then grouped by whether they are shopping, unhappy with a competitor, or just describing the pain. A digest you cannot finish is a digest you stop opening.",
  },
  {
    mark: "03 · HONEST",
    title: "A quiet day says so",
    body: "If nothing good turned up, the email tells you that in one line. Padding a slow morning with filler is the fastest way to teach you to ignore the thing you paid for.",
  },
];

const FAQ = [
  {
    q: "How is this different from a keyword alert?",
    a: "A keyword alert finds the word. This finds the situation. Someone writing “how did you all find your first customers?” never mentions your category — but they are describing exactly the problem you solve, and a keyword tool will never surface that post.",
  },
  {
    q: "Does it post replies for me?",
    a: "No, and it never will. IntentOwl drafts an angle; you write and send the reply yourself. Auto-posting is an instant ban on most platforms and a trust-destroyer everywhere else.",
  },
  {
    q: "What if there is nothing good on a given day?",
    a: "You get an email saying so. A quiet day is real information, and a digest that pads itself with filler is worse than one that admits it found little.",
  },
  {
    q: "How many leads should I expect?",
    a: "Between zero and fifteen a day, depending on how broad your space is. If you are consistently seeing zero after a week the watch is wrong, and I will fix it by hand — that is what the concierge setup is for.",
  },
  {
    q: "Which communities does it read?",
    a: "Hacker News, Lobsters and Stack Exchange today. Reddit and Bluesky are next. If there is a forum your customers actually live in, tell me and I will add it — that is usually a same-week job.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, from the link at the bottom of any digest. Monthly is monthly, and the founding price stays locked for as long as you stay.",
  },
];

/** The example lead shown in the framed digest. Illustrative, not a customer's. */
const SAMPLE_LEADS = [
  {
    score: 88,
    meta: "news.ycombinator.com · Ask HN · 41 comments",
    title:
      "Ask HN: I spend two hours a day scrolling forums looking for people with the problem we fix. Better way?",
    why: "Describes your exact workflow as a chore and is openly asking the room for an alternative.",
    angle:
      "Acknowledge the two hours before mentioning you built anything. Lead with how you would triage it by hand — the tool is the shortcut, not the answer.",
  },
  {
    score: 74,
    meta: "lobste.rs · ask · 12 comments",
    title:
      "Anyone moved off a keyword-alert setup? Mine fires forty times a day and I have started ignoring it.",
    why: "Actively unhappy with the category you replace, and already past the point of tolerating it.",
    angle:
      "Agree that volume is the failure, not coverage. Ask what fraction of the forty were worth opening — the number makes your case for you.",
  },
];

export default function LandingPage() {
  const monthly = checkout.monthly;
  const annual = checkout.annual;
  // Straight to checkout when Stripe is wired; otherwise the plan page, which
  // works either way. Never a dead button.
  const start = monthly ?? "/signup";

  return (
    <main>
      <section className="hero">
        <div className="page">
          <a className="badge" href="#sources">
            <span className="badge-dot" />
            Three communities live · Reddit next
          </a>

          <h1>
            Right now someone on{" "}
            <ScrambleWord words={SCRAMBLE_SOURCES} /> is{" "}
            <span className="dim">asking for what you built.</span>
          </h1>

          <p className="hero-sub">
            IntentOwl reads those communities all day, judges every post against
            what you actually sell, and sends you one ranked email at 7am. You
            write the reply.
          </p>

          <div className="hero-cta">
            <a className="btn btn-primary" href={start}>
              Start for $49/month
            </a>
            <a className="btn" href="#digest">
              See a real digest
            </a>
          </div>

          <p className="hero-fine">
            Founding price, locked for as long as you stay · Set up by hand
            within a day · Cancel any time
          </p>
        </div>
      </section>

      <section className="page showcase" id="digest">
        <div className="frame">
          <div className="frame-bar">
            <span className="frame-dots">
              <i />
              <i />
              <i />
            </span>
            <span>Inbox · 07:00 · IntentOwl daily digest</span>
          </div>
          <div className="digest">
            <div className="digest-head">
              <h3>11 leads worth your morning</h3>
              <p>
                Tuesday, from 3,140 posts read across three communities in the
                last 24 hours.
              </p>
            </div>
            <p className="group-label">Buying intent · 2 of 11</p>
            {SAMPLE_LEADS.map((lead) => (
              <article className="lead" key={lead.score}>
                <div className="score">{lead.score}</div>
                <div>
                  <p className="lead-meta">{lead.meta}</p>
                  <p className="lead-title">{lead.title}</p>
                  <p className="lead-why">{lead.why}</p>
                  <p className="lead-angle">
                    <b>Angle</b>
                    {lead.angle}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="page sources" id="sources">
        <p className="sources-label">Reading, every ten to twenty minutes</p>
        <ul className="source-row">
          {LIVE_SOURCES.map((name) => (
            <li key={name}>
              <span className="pulse" />
              {name}
            </li>
          ))}
          {NEXT_SOURCES.map((name) => (
            <li className="soon" key={name}>
              <span className="pulse" />
              {name}
            </li>
          ))}
        </ul>
      </section>

      <section className="section" id="how">
        <div className="page">
          <div className="section-head center">
            <p className="eyebrow">How it works</p>
            <h2>Three steps, and only one of them is yours.</h2>
            <p className="section-sub">
              Setup takes about three minutes. After that the only thing you do
              is read an email and decide who is worth talking to.
            </p>
          </div>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="page">
          <div className="section-head center">
            <p className="eyebrow">Why it finds things alerts miss</p>
            <h2>Most leads never say your keyword.</h2>
          </div>
          <div className="grid-3">
            {FEATURES.map((f) => (
              <div className="card" key={f.title}>
                <p className="card-mark">{f.mark}</p>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="page">
          <div className="section-head center">
            <p className="eyebrow">Pricing</p>
            <h2>One price. Set up by hand.</h2>
            <p className="section-sub">
              Founding pricing while IntentOwl is young. Whatever you pay when
              you join is what you keep paying.
            </p>
          </div>
          <div className="plans">
            <div className="plan featured">
              <div className="plan-top">
                <span className="plan-name">Monthly</span>
              </div>
              <p className="plan-price">
                $49<span> /month</span>
              </p>
              <ul>
                <PlanItem>One ranked digest every morning</PlanItem>
                <PlanItem>Every live source, no per-source pricing</PlanItem>
                <PlanItem>Watch tuned by hand in week one</PlanItem>
                <PlanItem>Cancel from any digest</PlanItem>
              </ul>
              <a className="btn btn-primary" href={monthly ?? "/signup"}>
                Start monthly
              </a>
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
                <PlanItem>Everything in monthly</PlanItem>
                <PlanItem>Two months of runway instead of twelve</PlanItem>
                <PlanItem>New sources added at no extra cost</PlanItem>
                <PlanItem>Price locked for as long as you stay</PlanItem>
              </ul>
              <a className="btn" href={annual ?? "/signup"}>
                Start annual
              </a>
            </div>
          </div>
          <p className="plan-note" style={{ marginTop: 18 }}>
            Reply to your receipt with what you sell and I will have your first
            digest running within a day.
          </p>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="page">
          <div className="section-head center">
            <p className="eyebrow">Questions</p>
            <h2>The ones people actually ask.</h2>
          </div>
          <div className="faq">
            {FAQ.map((item, i) => (
              <details key={item.q} open={i === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="closer">
        <div className="page">
          <h2>One email. Every morning. The people already asking.</h2>
          <div className="hero-cta">
            <a className="btn btn-primary" href={start}>
              Start for $49/month
            </a>
            <a className="btn" href="/login">
              Log in
            </a>
          </div>
          <p className="hero-fine">
            Nothing is ever posted on your behalf. You write every reply.
          </p>
        </div>
      </section>
    </main>
  );
}

function PlanItem({ children }: { children: ReactNode }) {
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
