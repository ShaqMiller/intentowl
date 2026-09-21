/**
 * Feedback landing page — the target of "Good lead" / "Not for me" in a digest.
 *
 * Opening the link records nothing. It shows the post and one button, and only
 * the button — a POST — writes. The previous version wrote on GET, and email
 * security scanners (Outlook Safe Links, Mimecast, Proofpoint) open every link
 * in a message before the reader does. On a GET-that-writes, a scanner opening
 * both links recorded a verdict nobody chose, and that verdict went straight
 * into the examples the classifier learns from. One extra click is the price
 * of training data a customer actually chose.
 *
 * Still no login: the signed token is the authorisation, as before. It carries
 * the customer and the item and cannot be forged without the secret, so it is
 * verified on the render and again inside the action.
 */
import {
  isFeedbackVerdict,
  leadHeadline,
  verifyFeedbackToken,
  type FeedbackVerdict,
} from "@intentowl/core";
import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { env } from "../../../../src/env.ts";
import { loadFeedbackTarget, saveFeedback } from "../../../../src/feedback.ts";
import { Owl, OwlLogo } from "../../../owl.tsx";

export const metadata: Metadata = {
  title: "Rate this lead",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

type State =
  | {
      kind: "ready";
      token: string;
      verdict: FeedbackVerdict;
      headline: string;
      current: FeedbackVerdict | null;
    }
  | { kind: "invalid" }
  | { kind: "unconfigured" }
  | { kind: "unknown-item" };

export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; verdict: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, verdict } = await params;
  const { recorded } = await searchParams;
  const state = await resolve(token, verdict);

  return (
    <main className="auth feedback">
      {/* No site nav on this page, so the wordmark says whose link it was. */}
      <a className="brand feedback-brand" href="/">
        <OwlLogo size={32} />
        IntentOwl
      </a>
      <div className="auth-card">{render(state, recorded === "1")}</div>
    </main>
  );
}

/** Verify and look up. Reads only — this runs for every scanner that opens the link. */
async function resolve(token: string, verdict: string): Promise<State> {
  const secret = env.FEEDBACK_SECRET;
  if (secret === undefined) return { kind: "unconfigured" };
  if (!isFeedbackVerdict(verdict)) return { kind: "invalid" };

  const claim = verifyFeedbackToken(secret, token);
  if (claim === null) return { kind: "invalid" };

  const target = await loadFeedbackTarget(claim.customerId, claim.itemId);
  if (target === null) return { kind: "unknown-item" };

  return {
    kind: "ready",
    token,
    verdict,
    headline: leadHeadline(target),
    current: target.verdict,
  };
}

/** The only write on this page. */
async function confirmFeedback(form: FormData) {
  "use server";

  const token = String(form.get("token") ?? "");
  const verdict = form.get("verdict");
  const back = `/f/${encodeURIComponent(token)}/${encodeURIComponent(String(verdict ?? ""))}`;

  const secret = env.FEEDBACK_SECRET;
  // Anything wrong sends the reader back to the GET, which explains the problem.
  if (secret === undefined || !isFeedbackVerdict(verdict)) redirect(back as Route);
  const claim = verifyFeedbackToken(secret, token);
  if (claim === null) redirect(back as Route);

  await saveFeedback(claim.customerId, claim.itemId, verdict);
  redirect(`${back}?recorded=1` as Route);
}

const LABEL: Record<FeedbackVerdict, string> = {
  up: "a good lead",
  down: "not for you",
};

function render(state: State, recorded: boolean) {
  if (state.kind === "ready") {
    const good = state.verdict === "up";
    const other: FeedbackVerdict = good ? "down" : "up";
    const switchHref = `/f/${state.token}/${other}`;

    // The redirect after a confirm lands here; trust the stored row, not the flag.
    if (recorded && state.current === state.verdict) {
      return (
        <>
          <Owl mood={good ? "happy" : "sleepy"} size={96} className="feedback-owl" />
          <h1>{good ? "Noted — more like that." : "Noted — fewer like that."}</h1>
          <p className="feedback-quote">“{state.headline}”</p>
          <div className={good ? "notice notice-leaf" : "notice notice-berry"}>
            {good
              ? "This one goes into the examples your classifier learns from, so leads like it score higher."
              : "This one goes into the examples your classifier learns from as a miss, so posts like it score lower."}{" "}
            It takes effect within the hour.
          </div>
          <p className="auth-alt">
            Changed your mind? <a href={switchHref}>Mark it {LABEL[other]}</a> ·{" "}
            <a href="/dashboard">Open your dashboard</a>
          </p>
        </>
      );
    }

    return (
      <>
        <Owl mood={good ? "happy" : "sleepy"} size={96} className="feedback-owl" />
        <h1>{good ? "Mark this as a good lead?" : "Mark this as not for you?"}</h1>
        <p className="feedback-quote">“{state.headline}”</p>
        {state.current !== null && state.current !== state.verdict && (
          <div className="notice">
            You marked this <b>{LABEL[state.current]}</b> before. Confirming replaces that.
          </div>
        )}
        {state.current === state.verdict && (
          <div className="notice">
            You already marked this <b>{LABEL[state.current]}</b>. Nothing to change.
          </div>
        )}
        <form action={confirmFeedback}>
          <input type="hidden" name="token" value={state.token} />
          <input type="hidden" name="verdict" value={state.verdict} />
          <button className={good ? "btn btn-leaf" : "btn btn-berry"} type="submit">
            {good ? "Yes, good lead" : "Yes, not for me"}
          </button>
        </form>
        <p className="auth-alt">
          Meant the other one? <a href={switchHref}>Mark it {LABEL[other]}</a>
        </p>
      </>
    );
  }

  if (state.kind === "unknown-item") {
    return (
      <>
        <h1>That lead is gone</h1>
        <p className="auth-lede">
          The post this link points at is no longer linked to any of your
          searches — most likely the search was removed. Nothing was recorded.
        </p>
        <a className="btn" href="/dashboard">
          Open your dashboard
        </a>
      </>
    );
  }

  if (state.kind === "unconfigured") {
    return (
      <>
        <h1>Feedback is not switched on</h1>
        <p className="auth-lede">
          This deployment has no feedback secret configured, so the link cannot
          be verified. Nothing was recorded.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>That link is not valid</h1>
      <p className="auth-lede">
        It may have been copied incompletely, or altered in transit. Nothing was
        recorded — open the digest and click the link directly.
      </p>
      <a className="btn" href="/dashboard">
        Open your dashboard
      </a>
    </>
  );
}
