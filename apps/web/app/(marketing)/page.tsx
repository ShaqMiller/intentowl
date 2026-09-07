/**
 * Landing page (ARCHITECTURE.md sections 4.7 and 4.8).
 *
 * One job: convince a founder that they are missing threads where people ask
 * for what they built, and that £49 to stop missing them is obvious. Checkout
 * is a Stripe Payment Link, so there is no payment code in the app at all.
 *
 * Everything claimed here has to be true today. The sources list is the
 * dangerous one — it is tempting to list Reddit because the adapter exists,
 * but it has never run against the live API, and a landing page is a promise.
 */
import type { Metadata } from "next";

import { env } from "../../src/env.ts";

export const metadata: Metadata = {
  title: "IntentOwl — never miss someone asking for what you built",
  description:
    "A daily digest of the posts where people describe the problem your product solves, ranked, with an angle for replying. You write the reply.",
};

/**
 * Sources that genuinely run in production today.
 *
 * Reddit is deliberately absent: the adapter is built and tested against
 * recorded fixtures but has never touched the live API, and app approval is
 * outstanding. Add it here on the day it actually polls, not before.
 */
const SOURCES = [
  { name: "Hacker News", note: "Ask HN, Show HN and every comment thread" },
  { name: "Lobsters", note: "small, high-signal, developer-heavy" },
  { name: "Stack Exchange", note: "where people describe problems in detail" },
];

const STEPS = [
  {
    title: "You describe what you sell",
    body: "Your product, who it is for, your competitors, and who is definitely not a customer. One paragraph each — this is the part that makes the results yours rather than generic.",
  },
  {
    title: "We read the communities, all day",
    body: "Every ten minutes, across every source. A keyword pass throws out the obvious noise for free, then Claude reads what is left against your description — not against a keyword list.",
  },
  {
    title: "You get one email at 7am",
    body: "Ranked, grouped, at most fifteen. Each lead has the post, why it matters to you specifically, and an angle to reply from. Nothing is auto-posted, ever.",
  },
];

const FAQ = [
  {
    q: "How is this different from a keyword alert?",
    a: "A keyword alert finds the word. This finds the situation. Someone writing “how did you all find your first customers?” never mentions your category — but they are describing exactly the problem you solve, and a keyword tool will never show you that post.",
  },
  {
    q: "Does it post replies for me?",
    a: "No, and it never will. The product drafts an angle; you write and send the reply yourself. Auto-posting is an instant ban on most platforms and a trust-destroyer everywhere else.",
  },
  {
    q: "What if there is nothing good on a given day?",
    a: "You get an email saying so. A quiet day is real information, and a digest that pads itself with filler is worse than one that admits it found little.",
  },
  {
    q: "How many leads should I expect?",
    a: "Between zero and fifteen a day, depending on how broad your space is. If you are consistently seeing zero after a week, the watch is wrong and I will fix it — that is what the concierge setup is for.",
  },
  {
    q: "Can I cancel?",
    a: "Any time, from the link in any digest. Monthly is monthly.",
  },
];

export default function LandingPage() {
  const monthly = env.STRIPE_LINK_MONTHLY;
  const annual = env.STRIPE_LINK_ANNUAL;
  const checkoutReady = monthly !== undefined || annual !== undefined;

  return (
    <>
      <style>{CSS}</style>

      <header className="hero">
        <div className="wrap">
          <p className="eyebrow">IntentOwl</p>
          <h1>
            You are missing the threads where people ask for what you built.
          </h1>
          <p className="standfirst">
            Every day, somebody describes the exact problem your product solves
            — in a subreddit you do not read, or a thread you scrolled past.
            IntentOwl reads them all and sends you the ones that matter, with an
            angle for replying that will not read as an ad.
          </p>
          <div className="cta-row">
            {monthly !== undefined && (
              <a className="btn primary" href={monthly}>
                Start — $49/month
              </a>
            )}
            {annual !== undefined && (
              <a className="btn" href={annual}>
                $199/year — save 66%
              </a>
            )}
            {!checkoutReady && (
              <span className="soon">Checkout opens shortly.</span>
            )}
          </div>
          <p className="fine">
            Founding price, locked for as long as you stay. Cancel any time.
          </p>
        </div>
      </header>

      <section className="wrap band">
        <h2>What you actually get</h2>
        <div className="sample" role="img" aria-label="An example lead as it appears in the daily digest.">
          <p className="sample-label">Buying intent · 1 of 11</p>
          <p className="sample-meta">r/SaaS · founder_jane · 88</p>
          <p className="sample-title">
            Spending 2 hours a day scrolling Reddit for people asking about
            invoicing tools. There has to be a better way?
          </p>
          <p className="sample-reason">
            Describes your exact workflow as a chore, and is actively asking the
            room for an alternative.
          </p>
          <p className="sample-angle">
            <b>Angle ·</b> Acknowledge the two hours before mentioning you built
            anything. Lead with how you would triage it by hand — the tool is
            the shortcut, not the answer.
          </p>
        </div>
        <p className="sample-note">
          That is one lead. A normal morning has five to fifteen, grouped by
          whether the person is shopping, complaining about a competitor, or
          just describing the pain.
        </p>
      </section>

      <section className="wrap band">
        <h2>How it works</h2>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap band">
        <h2>Where it reads</h2>
        <ul className="sources">
          {SOURCES.map((s) => (
            <li key={s.name}>
              <b>{s.name}</b>
              <span>{s.note}</span>
            </li>
          ))}
        </ul>
        <p className="sample-note">
          Reddit and Bluesky are next. If there is a forum your customers live
          in, tell me and I will add it — that is usually a same-week job.
        </p>
      </section>

      <section className="wrap band">
        <h2>Questions</h2>
        <dl className="faq">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap closer">
        <h2>One email. Every morning. The people already asking.</h2>
        <div className="cta-row">
          {monthly !== undefined && (
            <a className="btn primary" href={monthly}>
              Start — $49/month
            </a>
          )}
          {annual !== undefined && (
            <a className="btn" href={annual}>
              $199/year
            </a>
          )}
        </div>
        <p className="fine">
          Set up by hand, by me, within a day of signing up. Reply to the
          receipt and tell me what you sell.
        </p>
      </section>

      <footer className="wrap foot">
        <span>IntentOwl</span>
        <span>Never posts on your behalf.</span>
      </footer>
    </>
  );
}

const CSS = `
:root {
  --ground:#F4F6F7; --surface:#FFFFFF; --surface-2:#EDF1F3;
  --ink:#131A20; --ink-soft:#3D4A55; --muted:#5F6E7A; --faint:#8695A1;
  --line:#D9E0E5; --line-strong:#BFCAD2;
  --accent:#0E6E78; --accent-soft:#DCEEF0; --accent-ink:#0A545C; --ok:#2E7D53;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground:#0E1418; --surface:#151D23; --surface-2:#1B252C;
    --ink:#E4ECF1; --ink-soft:#C0CED8; --muted:#93A5B1; --faint:#71838F;
    --line:#26323A; --line-strong:#38474F;
    --accent:#45B5C0; --accent-soft:#13343A; --accent-ink:#7FD3DB; --ok:#5CBF88;
  }
}
* { box-sizing: border-box; }
body {
  margin:0; background:var(--ground); color:var(--ink); line-height:1.6;
  font-family:"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing:antialiased;
}
h1,h2,h3 { font-family:"IBM Plex Sans Condensed","IBM Plex Sans",system-ui,sans-serif; font-weight:600; margin:0; text-wrap:balance; line-height:1.15; letter-spacing:-.005em; }
.wrap { max-width:760px; margin:0 auto; padding:0 24px; }
.hero { background:var(--surface); border-bottom:1px solid var(--line); padding:64px 0 52px; }
.eyebrow { font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:11.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:0 0 20px; }
.hero h1 { font-size:clamp(32px,5.4vw,50px); max-width:16ch; }
.standfirst { margin:22px 0 0; max-width:60ch; font-size:18px; color:var(--ink-soft); }
.cta-row { display:flex; gap:12px; flex-wrap:wrap; margin-top:30px; align-items:center; }
.btn {
  display:inline-block; font-size:15px; font-weight:600; padding:11px 22px;
  border-radius:7px; border:1px solid var(--line-strong); background:var(--surface);
  color:var(--ink); text-decoration:none;
}
.btn:hover { border-color:var(--accent); color:var(--accent); }
.btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.btn.primary:hover { color:#fff; opacity:.92; }
.soon { font-size:14px; color:var(--muted); }
.fine { margin:14px 0 0; font-size:13.5px; color:var(--faint); }
.band { padding:48px 0 0; }
.band h2 { font-size:clamp(22px,3vw,28px); margin-bottom:18px; border-top:2px solid var(--ink); padding-top:14px; }
.sample { background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:20px 22px; }
.sample-label { margin:0 0 10px; font-family:"IBM Plex Mono",monospace; font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--faint); }
.sample-meta { margin:0 0 4px; font-size:12.5px; color:var(--faint); }
.sample-title { margin:0 0 8px; font-size:17px; font-weight:600; line-height:1.35; }
.sample-reason { margin:0 0 10px; font-size:14.5px; color:var(--ink-soft); }
.sample-angle { margin:0; padding:10px 13px; font-size:14px; color:var(--ink-soft); background:var(--ground); border-left:3px solid var(--accent); border-radius:0 5px 5px 0; }
.sample-angle b { color:var(--accent); }
.sample-note { margin:14px 0 0; font-size:14.5px; color:var(--muted); max-width:64ch; }
.steps { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:22px; }
.steps li { display:flex; gap:16px; align-items:flex-start; }
.step-n { font-family:"IBM Plex Mono",monospace; font-size:12px; font-weight:600; color:var(--accent); border:1px solid var(--accent-soft); background:var(--accent-soft); border-radius:4px; padding:3px 8px; flex:none; margin-top:2px; }
.steps h3 { font-size:17px; margin-bottom:4px; }
.steps p { margin:0; color:var(--ink-soft); font-size:15px; max-width:62ch; }
.sources { list-style:none; padding:0; margin:0 0 4px; display:flex; flex-direction:column; gap:10px; }
.sources li { display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; padding-bottom:10px; border-bottom:1px solid var(--line); }
.sources b { min-width:150px; }
.sources span { color:var(--muted); font-size:14.5px; }
.faq { margin:0; }
.faq div { padding:16px 0; border-bottom:1px solid var(--line); }
.faq dt { font-weight:600; font-size:16px; margin-bottom:6px; }
.faq dd { margin:0; color:var(--ink-soft); font-size:15px; max-width:64ch; }
.closer { padding:52px 0 8px; }
.closer h2 { border-top:none; padding-top:0; max-width:20ch; }
.foot { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; padding-top:32px; padding-bottom:48px; margin-top:32px; border-top:1px solid var(--line); font-size:13px; color:var(--faint); }
`;
