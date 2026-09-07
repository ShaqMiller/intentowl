/**
 * Seeds classifications from the hand-labelled golden set so the digest can be
 * rendered without spending anything on the API.
 *
 * These are the *labels*, not model output — the reason and reply angle are
 * written from each case's note. Good enough to judge layout, ranking and
 * whether the thing reads as worth $49; not a substitute for the real eval.
 */
import { readFileSync } from "node:fs";

import { createDb, schema } from "@intentowl/db";
import { eq, sql } from "drizzle-orm";

import { env } from "../src/env.ts";

interface GoldenCase {
  id: string;
  url: string;
  source: "hn";
  venue: string | null;
  title: string;
  body: string | null;
  expect: { relevant: boolean; intent: string; minScore: number; maxScore: number };
  note: string;
}

const golden = JSON.parse(
  readFileSync("../../../packages/core/classify/evals/golden.json", "utf8"),
) as { cases: GoldenCase[] };

/**
 * Placeholder reason and angle text.
 *
 * The classifier writes these for real; until it has run, fixed strings would
 * make every lead look identical and the preview would misrepresent the
 * product in the other direction. These vary by intent and quote the post, so
 * the layout can be judged honestly — but they are NOT model output.
 */
function reasonFor(c: GoldenCase): string {
  const subject = c.title.replace(/^(Ask HN:?|Show HN:?|Tell HN:?)\s*/i, "").trim();
  const short = subject.length > 62 ? `${subject.slice(0, 62)}…` : subject;
  switch (c.expect.intent) {
    case "buying_intent":
      return `Actively shopping — asking the community what to use, and describes the exact workflow you replace.`;
    case "competitor_complaint":
      return `Using a competitor and unhappy about it. The need is proven and the budget already exists.`;
    case "pain_point":
      return `Describes the problem in their own words without knowing a tool exists: "${short}"`;
    case "question":
      return `Researching the problem space rather than shopping — worth a helpful answer, not a pitch.`;
    default:
      return `Adjacent to your space but no evident need.`;
  }
}

function angleFor(c: GoldenCase): string {
  switch (c.expect.intent) {
    case "buying_intent":
      return "They are already comparing options, so lead with the one thing you do differently rather than a feature list. Name the manual workflow they described back to them first.";
    case "competitor_complaint":
      return "Do not attack the competitor — agree with the specific complaint, then describe how you approached that problem. Offer to migrate their setup.";
    case "pain_point":
      return "They have not asked for a tool, so do not sell one. Answer the question properly, mention what you built only if it comes up naturally.";
    case "question":
      return "Answer as a peer who has solved this. A useful reply here buys attention later; a pitch burns it.";
    default:
      return "";
  }
}

const { pool, db } = createDb(env.DATABASE_URL);

// The fixture customer's name shows up in the digest headline.
await db
  .update(schema.customers)
  .set({ name: "Acme Analytics" })
  .where(eq(schema.customers.email, "fixture@intentowl.local"));

const watches = await db.select().from(schema.watches).limit(1);
const watch = watches[0];
if (watch === undefined) throw new Error("no watch found");

let items = 0;
let classifications = 0;

for (const c of golden.cases) {
  // Mid-band score, and a plausible recent posting time so recency decay has
  // something to sort by rather than every lead being equally stale.
  const score = Math.round((c.expect.minScore + c.expect.maxScore) / 2);
  const hoursAgo = 1 + (score % 30);
  const postedAt = new Date(Date.now() - hoursAgo * 3_600_000);

  const [item] = await db
    .insert(schema.items)
    .values({
      source: c.source,
      externalId: `golden-${c.id}`,
      url: c.url,
      author: `hn_user_${c.id.slice(-4)}`,
      title: c.title,
      body: c.body,
      venue: c.venue ?? "news.ycombinator.com",
      postedAt,
      engagement: { points: 10 + (score % 90), comments: score % 40 },
    })
    .onConflictDoUpdate({
      target: [schema.items.source, schema.items.externalId],
      set: { postedAt, title: c.title, body: c.body },
    })
    .returning({ id: schema.items.id });

  if (item === undefined) continue;
  items += 1;

  await db
    .insert(schema.itemWatches)
    .values({ itemId: item.id, watchId: watch.id })
    .onConflictDoNothing();

  await db
    .insert(schema.classifications)
    .values({
      itemId: item.id,
      watchId: watch.id,
      relevant: c.expect.relevant,
      intent: c.expect.intent as (typeof schema.intent.enumValues)[number],
      score,
      reason: reasonFor(c),
      replyAngle: c.expect.relevant ? angleFor(c) : "",
      model: "golden-label",
    })
    .onConflictDoUpdate({
      target: [
        schema.classifications.itemId,
        schema.classifications.watchId,
        schema.classifications.model,
      ],
      set: { score, reason: reasonFor(c), replyAngle: c.expect.relevant ? angleFor(c) : "", relevant: c.expect.relevant },
    });
  classifications += 1;
}

const countsResult = await db.execute<{ items: number; cls: number }>(
  sql`select (select count(*)::int from items) items, (select count(*)::int from classifications) cls`,
);

console.log(`seeded ${items} items, ${classifications} classifications`);
console.log(`totals: ${JSON.stringify(countsResult.rows[0])}`);
console.log(`customer_id ${watch.customerId}`);

await pool.end();
