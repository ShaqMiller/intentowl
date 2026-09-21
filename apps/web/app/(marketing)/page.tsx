/**
 * Landing page (ARCHITECTURE.md sections 4.7 and 4.8), in the "Morning Paper"
 * design system.
 *
 * One job: convince a founder that they are missing threads where people ask
 * for what they built, and that a free week of finding out costs them nothing.
 * Checkout is a Stripe Payment Link with the trial on it, so there is no
 * payment code in the app at all.
 *
 * Everything claimed here has to be true today. The sources list is the
 * dangerous one — it is tempting to list Reddit because the adapter exists,
 * but it has never run against the live API, and a landing page is a promise.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getPublicActivity, type PublicActivity } from "../../src/queries.ts";
import { Owl } from "../owl.tsx";
import { PlanCards } from "./plans.tsx";
import { ScrambleWord } from "./scramble-word.tsx";

export const metadata: Metadata = {
  title: "Never miss someone asking for what you built",
  description:
    "A daily digest of the posts where people describe the problem your product solves, ranked, with an angle for replying. You write the reply.",
};

/**
 * Sources that genuinely poll in production today.
 *
 * Reddit and Threads are deliberately absent from `live`: both adapters are
 * built but wait on platform approval. They move up on the day they poll.
 */
const LIVE_SOURCES = [
  "Hacker News",
  "Lobsters",
  "Stack Exchange",
  "Bluesky",
  "RSS feeds",
];
const NEXT_SOURCES = ["Reddit", "Threads"];

/** The rotating word in the headline — live sources only, same promise. */
const SCRAMBLE_SOURCES = ["Hacker News", "Lobsters", "Stack Exchange"];

const STEPS = [
  {
    tag: "You · 3 minutes",
    title: "You describe what you sell",
    body: "Your product, who it is for, your competitors, and who is definitely not a customer. One paragraph each. This is the part that makes the results yours instead of generic.",
  },
  {
    tag: "IntentOwl · all day",
    title: "We read the communities all day",
    body: "Every ten to twenty minutes, across every source. A cheap keyword pass throws out the obvious noise, then Claude reads what survives against your description — not against a keyword list.",
  },
  {
    tag: "IntentOwl · 7am",
    title: "You get one email at 7am",
    body: "Ranked, grouped, fifteen at most. Each lead carries the post, why it matters to you specifically, and an angle to reply from. Nothing is ever auto-posted.",
  },
];

const FEATURES = [
  {
    title: "It reads the situation, not the keyword",
    body: "“How did you all find your first customers?” never mentions your category, so no alert tool will ever show it to you. It is also the single best thread you could reply to this week.",
  },
  {
    title: "Scored, grouped, and capped at fifteen",
    body: "Sorted by how close the person is to buying, then grouped by whether they are shopping, unhappy with a competitor, or just describing the pain. A digest you cannot finish is a digest you stop opening.",
  },
  {
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
    a: "Hacker News, Lobsters, Stack Exchange, Bluesky, and any site with an RSS feed. Reddit is pending API approval. If there is a forum your customers live in that has a feed, it works today — and if it does not, adding it is usually a same-week job.",
  },
  {
    q: "What is the difference between Starter and Pro?",
    a: "How many searches run at once. A search is one set of terms and places to watch. Starter runs one, and you can rewrite it whenever you change direction. Pro runs up to three side by side — a second product, a different audience, or a competitor's unhappy customers.",
  },
  {
    q: "How does the free trial work?",
    a: "Your first 7 days are free. Checkout takes a card so there is nothing to re-enter if you stay, but nothing is charged until day 8 — cancel before then and you pay nothing.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, from the link at the bottom of any digest. Monthly is monthly; cancel mid-month and the digest keeps coming until the period you paid for ends.",
  },
];

/** The example leads shown in the sample digest. Illustrative, not a customer's. */
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

/**
 * Re-rendered at most once a minute.
 *
 * The activity strip reads the database, and a marketing page must not query
 * Postgres once per visitor. A minute is fresh enough to answer "is it
 * running" and turns any amount of traffic into sixty queries an hour.
 */
export const revalidate = 60;

export default async function LandingPage() {
  const activity = await getPublicActivity();

  return (
    <main>
      <section className="hero">
        <div className="page hero-grid">
          <div className="hero-copy">
            <a className="badge" href="#sources">
              <span className="badge-dot" />
              Five sources live · Reddit next
            </a>

            <h1>
              Right now someone on <ScrambleWord words={SCRAMBLE_SOURCES} /> is{" "}
              <span className="dim">asking for what you built.</span>
            </h1>

            <p className="hero-sub">
              IntentOwl reads those communities all day, judges every post
              against what you actually sell, and sends you one ranked email at
              7am. You write the reply.
            </p>

            <div className="hero-cta">
              {/* To the plans, not straight to checkout: with two tiers the
                  choice is the next step, and the trial makes it a cheap one. */}
              <a className="btn btn-primary btn-lg" href="#pricing">
                Start your 7-day free trial
                <ArrowIcon />
              </a>
              <a className="btn btn-lg" href="#digest">
                See a real digest
              </a>
            </div>

            <p className="hero-fine">7 days free · From $15/month after · Cancel any time</p>
          </div>

          <div className="hero-art" id="digest">
            <Owl mood="watching" size={110} className="hero-owl" />
            <div className="mail">
              <div className="mail-head">
                <p className="mail-from">Inbox · 07:00 · IntentOwl daily digest</p>
                <h3>11 leads worth your morning</h3>
                <p className="mail-sub">
                  Tuesday, from 3,140 posts read across three communities in the
                  last 24 hours.
                </p>
              </div>
              <p className="mail-group">Buying intent · 2 of 11</p>
              {SAMPLE_LEADS.map((lead, i) => (
                <article className="mail-lead" key={lead.score}>
                  <span className={i === 0 ? "score-badge" : "score-badge soft"}>{lead.score}</span>
                  <div className="mail-lead-body">
                    <p className="mail-meta">
                      <span className="intent intent-tool">Buying intent</span>
                      {lead.meta}
                    </p>
                    <p className="mail-title">{lead.title}</p>
                    <p className="mail-why">{lead.why}</p>
                    <p className="angle">
                      <b>Angle:</b> {lead.angle}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sources" id="sources">
        <div className="page">
          <ActivityStrip activity={activity} />
        </div>
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
          <ol className="how-grid">
            {STEPS.map((step, i) => (
              <li className="how-card" key={step.title}>
                <div className={`how-art how-art-${i + 1}`}>{STEP_ART[i]}</div>
                <div className="how-body">
                  <div className="how-tags">
                    <span className="num">{i + 1}</span>
                    <span className={i === 0 ? "tag tag-honey" : "tag"}>{step.tag}</span>
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section-sunken">
        <div className="page">
          <div className="compare">
            <div className="compare-copy">
              <p className="eyebrow">Why it finds things alerts miss</p>
              <h2>Most leads never say your keyword.</h2>
            </div>
            {/* An illustration of the difference, not a real post. */}
            <div className="compare-demo" aria-label="Example: a post a keyword alert misses">
              <div className="post-card">
                <p className="post-meta">Lobsters · 1h ago</p>
                <p className="post-text">
                  “Spent the weekend writing a script to ping our API every five
                  minutes. There has to be a better way?”
                </p>
              </div>
              <div className="verdicts">
                <div className="verdict verdict-miss">
                  <span className="verdict-icon">
                    <CrossIcon />
                  </span>
                  <span>
                    <b>Keyword alert</b>
                    <small>“uptime monitor”: no match</small>
                  </span>
                </div>
                <div className="verdict verdict-hit">
                  <span className="verdict-icon">
                    <CheckIcon />
                  </span>
                  <span>
                    <b>IntentOwl</b>
                    <small>Score 91 · Describing a pain</small>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid-3">
            {FEATURES.map((f, i) => (
              <div className="card feature" key={f.title}>
                <span className={`icon-tile icon-tile-${i + 1}`}>{FEATURE_ICONS[i]}</span>
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
            <h2>Two plans. Both start free.</h2>
            <p className="section-sub">
              Starter watches one thing for you. Pro watches up to three at once.
              Either way, the first week is on us.
            </p>
          </div>
          <PlanCards />
        </div>
      </section>

      <section className="section section-faq" id="faq">
        <div className="page faq-grid">
          <div className="faq-head">
            <p className="eyebrow">Questions</p>
            <h2>The ones people actually ask.</h2>
          </div>
          <div className="faq">
            {FAQ.map((item, i) => (
              <details key={item.q} open={i === 0}>
                <summary>
                  {item.q}
                  <span className="faq-toggle" aria-hidden="true" />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="closer">
        <div className="page">
          <div className="closer-card">
            <div className="closer-copy">
              <h2>One email. Every morning. The people already asking.</h2>
              <p className="closer-fine">
                Nothing is ever posted on your behalf. You write every reply.
              </p>
              <div className="hero-cta">
                <a className="btn btn-dark btn-lg" href="#pricing">
                  Start your 7-day free trial
                </a>
                <a className="btn btn-lg" href="/login">
                  Log in
                </a>
              </div>
            </div>
            <Owl mood="happy" size={220} body="#FFFFFF" belly="#FDEFC9" className="closer-owl" />
          </div>
        </div>
      </section>
    </main>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  hn: "Hacker News",
  lobsters: "Lobsters",
  stackexchange: "Stack Exchange",
  bluesky: "Bluesky",
  threads: "Threads",
  rss: "RSS feeds",
};

/** "4 min ago", or a plain note when a source has never been polled. */
function ago(date: Date | null): string {
  if (date === null) return "not polled yet";
  const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Live proof the pipeline is running — counts and timestamps, never content.
 *
 * A feed of the posts themselves would publish a list of real people being
 * targeted for sales outreach, and would leak the search terms customers pay
 * to have worked out. A number that moves buys the same credibility and costs
 * nobody anything.
 *
 * Falls back to the plain source list when the database is unreachable, so a
 * stats widget can never take the landing page down with it.
 */
function ActivityStrip({ activity }: { activity: PublicActivity | null }) {
  if (activity === null) {
    return (
      <>
        <p className="sources-label">
          <span className="live-dot" aria-hidden="true" />
          Reading, every ten to twenty minutes
        </p>
        <ul className="source-pills">
          {LIVE_SOURCES.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {NEXT_SOURCES.map((name) => (
            <li className="soon" key={name}>
              {name} · soon
            </li>
          ))}
        </ul>
      </>
    );
  }

  const live = activity.sources.filter((s) => s.lastPolledAt !== null).length;
  const polled = new Set(activity.sources.map((s) => s.source));

  return (
    <>
      <p className="sources-label">
        <span className="live-dot" aria-hidden="true" />
        {live} sources polling right now ·{" "}
        <b>{activity.postsRead24h.toLocaleString()}</b> posts read in the last
        24 hours · {activity.postsReadTotal.toLocaleString()} all time
      </p>

      <ul className="source-pills">
        {activity.sources.map((s) => (
          <li className={s.lastPolledAt === null ? "soon" : undefined} key={s.source}>
            {SOURCE_LABELS[s.source] ?? s.source}
            <span className="source-when">{ago(s.lastPolledAt)}</span>
          </li>
        ))}
        {NEXT_SOURCES.filter((name) => !polled.has(name.toLowerCase())).map((name) => (
          <li className="soon" key={name}>
            {name} · soon
            <span className="source-when">awaiting approval</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- illustrations ----------------------------------------------------------
// Inline so they inherit nothing and cost no requests. Geometry from the
// design system's home page artboard.

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const STEP_ART: ReactNode[] = [
  <svg key="describe" width="220" height="140" viewBox="0 0 220 140" aria-hidden="true">
    <rect x="30" y="18" width="160" height="108" rx="14" fill="#FFFFFF" stroke="#1C1A16" strokeWidth="3" />
    <rect x="48" y="38" width="80" height="10" rx="5" fill="#1C1A16" />
    <rect x="48" y="60" width="124" height="8" rx="4" fill="#E6DCC8" />
    <rect x="48" y="76" width="110" height="8" rx="4" fill="#E6DCC8" />
    <rect x="48" y="92" width="70" height="8" rx="4" fill="#E6DCC8" />
    <path d="M150 112 L186 76 L198 88 L162 124 L146 128 Z" fill="#F5B83D" stroke="#1C1A16" strokeWidth="3" strokeLinejoin="round" />
  </svg>,
  <svg key="read" width="220" height="140" viewBox="0 0 220 140" aria-hidden="true">
    <rect x="22" y="20" width="76" height="44" rx="10" fill="#FFFFFF" stroke="#1C1A16" strokeWidth="3" />
    <rect x="108" y="20" width="76" height="44" rx="10" fill="#FFFFFF" stroke="#1C1A16" strokeWidth="3" />
    <rect x="22" y="76" width="76" height="44" rx="10" fill="#F5B83D" stroke="#1C1A16" strokeWidth="3" />
    <rect x="108" y="76" width="76" height="44" rx="10" fill="#FFFFFF" stroke="#1C1A16" strokeWidth="3" />
    <rect x="34" y="34" width="44" height="6" rx="3" fill="#E6DCC8" />
    <rect x="120" y="34" width="50" height="6" rx="3" fill="#E6DCC8" />
    <rect x="34" y="90" width="50" height="6" rx="3" fill="#1C1A16" />
    <rect x="120" y="90" width="40" height="6" rx="3" fill="#E6DCC8" />
    <circle cx="78" cy="102" r="22" fill="none" stroke="#1C1A16" strokeWidth="5" />
    <path d="M94 118 L112 136" stroke="#1C1A16" strokeWidth="7" strokeLinecap="round" />
  </svg>,
  <svg key="email" width="220" height="140" viewBox="0 0 220 140" aria-hidden="true">
    <rect x="40" y="30" width="140" height="92" rx="12" fill="#FFFFFF" stroke="#1C1A16" strokeWidth="3" />
    <path d="M42 34 L110 84 L178 34" fill="none" stroke="#1C1A16" strokeWidth="3" strokeLinejoin="round" />
    <rect x="128" y="8" width="76" height="34" rx="17" fill="#F5B83D" stroke="#1C1A16" strokeWidth="3" />
    <text x="166" y="31" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight="600" fontSize="15" fill="#1C1A16">
      7:00
    </text>
  </svg>,
];

const FEATURE_ICONS: ReactNode[] = [
  <svg key="eye" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1C1A16" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>,
  <svg key="bars" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1C1A16" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>,
  <svg key="moon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1C1A16" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>,
];
