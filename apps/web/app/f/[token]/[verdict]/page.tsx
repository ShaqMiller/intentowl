/**
 * Feedback landing page — the target of the thumbs in a digest email.
 *
 * A GET request that writes. That is normally a mistake, but the alternative
 * is asking someone to log in to say "good lead", which means nobody ever
 * does, which means `profiles.few_shot_examples` stays empty and the
 * classifier never learns this customer's taste.
 *
 * The signed token is what makes it safe: it carries the customer and item,
 * cannot be forged without the secret, and the write is an idempotent upsert
 * keyed on (customer, item). So the two real hazards of a GET-that-writes —
 * forgery, and mail clients prefetching links — both degrade to a no-op or a
 * repeat of what the customer intended.
 *
 * Prefetch is worth stating plainly: some clients fetch every link in an
 * email. Those fetches land here and record a verdict the reader never chose.
 * The upsert means a later real click overwrites it, and the page shows what
 * was recorded with a way to change it, so a wrong prefetch is visible and
 * reversible rather than silent.
 */
import { isFeedbackVerdict, verifyFeedbackToken } from "@intentowl/core";
import { schema } from "@intentowl/db";
import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { getDb } from "../../../../src/db.ts";
import { env } from "../../../../src/env.ts";

export const metadata: Metadata = {
  title: "Thanks",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

type Outcome =
  | { kind: "recorded"; verdict: "up" | "down"; title: string | null }
  | { kind: "invalid" }
  | { kind: "unconfigured" }
  | { kind: "unknown-item" };

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ token: string; verdict: string }>;
}) {
  const { token, verdict } = await params;
  const outcome = await record(token, verdict);

  return (
    <main className="auth">
      <div className="auth-card">{render(outcome)}</div>
    </main>
  );
}

async function record(token: string, verdict: string): Promise<Outcome> {
  const secret = env.FEEDBACK_SECRET;
  if (secret === undefined) return { kind: "unconfigured" };
  if (!isFeedbackVerdict(verdict)) return { kind: "invalid" };

  const claim = verifyFeedbackToken(secret, token);
  if (claim === null) return { kind: "invalid" };

  const db = getDb();

  // Confirm the item is genuinely linked to one of this customer's watches.
  // The signature already proves the pair came from us, but this also catches
  // a stale token for a watch that has since been deleted, and keeps the
  // foreign keys honest rather than relying on the signature alone.
  const linked = await db
    .select({ title: schema.items.title })
    .from(schema.itemWatches)
    .innerJoin(schema.items, eq(schema.items.id, schema.itemWatches.itemId))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.itemWatches.watchId))
    .where(
      and(
        eq(schema.itemWatches.itemId, claim.itemId),
        eq(schema.watches.customerId, claim.customerId),
      ),
    )
    .limit(1);

  const row = linked[0];
  if (row === undefined) return { kind: "unknown-item" };

  await db
    .insert(schema.feedback)
    .values({
      customerId: claim.customerId,
      itemId: claim.itemId,
      verdict,
    })
    // Latest verdict wins. Someone who clicks down then up meant up.
    .onConflictDoUpdate({
      target: [schema.feedback.customerId, schema.feedback.itemId],
      set: { verdict, createdAt: new Date() },
    });

  return { kind: "recorded", verdict, title: row.title };
}

function render(outcome: Outcome) {
  if (outcome.kind === "recorded") {
    const good = outcome.verdict === "up";
    return (
      <>
        <h1>{good ? "Noted — more like that." : "Noted — fewer like that."}</h1>
        {outcome.title !== null && <p className="auth-lede">“{outcome.title}”</p>}
        <div className="notice">
          {good
            ? "This one goes into the examples your classifier learns from, so leads like it score higher."
            : "This one is recorded as a miss. Enough of them and the search terms behind it are worth revisiting."}
        </div>
        <p className="auth-alt">
          Changed your mind? Click the other link in the digest — the last click
          wins. <a href="/dashboard">Open your dashboard</a>.
        </p>
      </>
    );
  }

  if (outcome.kind === "unknown-item") {
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

  if (outcome.kind === "unconfigured") {
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
