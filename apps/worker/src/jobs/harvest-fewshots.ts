/**
 * Turns customer feedback into calibration examples (ARCHITECTURE.md § 4.3).
 *
 * This is the half of the feedback loop that was missing. The classifier
 * already reads `profiles.few_shot_examples` and injects them into the prompt;
 * until now nothing ever wrote that column, so every customer's classifier
 * stayed exactly as calibrated as the generic rubric.
 *
 * The interesting decision is *which* feedback becomes an example. A thumbs-up
 * on a post the model already scored 90 teaches nothing — the model was
 * already right. What teaches is disagreement: the lead the customer liked
 * that scored low, and the one they rejected that scored high. So examples are
 * picked by how wrong the model was, not by how recent the click is.
 *
 * The rubric asks for 3-5 examples; more dilutes the instruction and costs
 * tokens on every single classification call.
 */
import { leadHeadline, type FewShot } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";
import { withOpsAlert } from "../ops.ts";

export const HARVEST_QUEUE = "harvest-fewshots";

export const HARVEST_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 300,
} as const;

/** How many examples end up in the prompt. */
const MAX_SHOTS = 5;

/** How much feedback to consider. Beyond this, older clicks stop mattering. */
const CONSIDER = 200;

export interface HarvestOutcome {
  customerId: string;
  considered: number;
  written: number;
}

/**
 * Rebuild one customer's few-shot examples from their feedback.
 *
 * Rebuild rather than append: the column is derived data, and recomputing it
 * means a customer who changes their mind is not stuck with an example that
 * contradicts their current taste.
 */
export async function harvestForCustomer(
  db: Db,
  customerId: string,
): Promise<HarvestOutcome> {
  const rows = await db
    .select({
      itemId: schema.feedback.itemId,
      verdict: schema.feedback.verdict,
      createdAt: schema.feedback.createdAt,
      title: schema.items.title,
      body: schema.items.body,
      relevant: schema.classifications.relevant,
      intent: schema.classifications.intent,
      score: schema.classifications.score,
      reason: schema.classifications.reason,
    })
    .from(schema.feedback)
    .innerJoin(schema.items, eq(schema.items.id, schema.feedback.itemId))
    .innerJoin(
      schema.watches,
      eq(schema.watches.customerId, schema.feedback.customerId),
    )
    .innerJoin(
      schema.classifications,
      and(
        eq(schema.classifications.itemId, schema.feedback.itemId),
        eq(schema.classifications.watchId, schema.watches.id),
      ),
    )
    .where(eq(schema.feedback.customerId, customerId))
    .orderBy(desc(schema.feedback.createdAt))
    .limit(CONSIDER);

  // One row per item: an item can carry both a Haiku and a Sonnet verdict, and
  // the escalated one is the score the customer was reacting to.
  //
  // Keyed by item, not title. Keying by title skipped every untitled post, and
  // Bluesky posts never have one — so a customer's clicks on Bluesky leads were
  // recorded and then silently never taught the classifier anything.
  const byItem = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = byItem.get(row.itemId);
    if (existing === undefined || row.score > existing.score) {
      byItem.set(row.itemId, row);
    }
  }

  const candidates = [...byItem.values()].map((row) => {
    const wanted = row.verdict === "up";
    // How badly the model missed. A thumbs-up on a 20 is a surprise worth
    // teaching; a thumbs-up on a 95 is agreement and teaches nothing.
    const surprise = wanted ? 100 - row.score : row.score;
    return { row, wanted, surprise };
  });

  candidates.sort((a, b) => b.surprise - a.surprise);

  const shots: FewShot[] = candidates.slice(0, MAX_SHOTS).map(({ row, wanted }) => ({
    // renderFewShots prints this as "Post:", with the body underneath.
    title: leadHeadline(row),
    body: row.body,
    // The customer's verdict overrides the model's — that is the entire point.
    relevant: wanted,
    intent: (wanted ? row.intent : "none") as FewShot["intent"],
    // Anchor the score to the human judgement rather than replaying the miss.
    score: wanted ? Math.max(row.score, 75) : Math.min(row.score, 20),
    reason: wanted
      ? (row.reason ?? "The customer marked this a good lead.")
      : "The customer marked this a bad lead: it looked relevant but was not.",
  }));

  await db
    .insert(schema.profiles)
    .values({ customerId, fewShotExamples: shots, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.profiles.customerId,
      set: { fewShotExamples: shots, updatedAt: new Date() },
    });

  return { customerId, considered: rows.length, written: shots.length };
}

/** Rebuild for every customer who has given feedback. */
export async function runHarvest(db: Db): Promise<HarvestOutcome[]> {
  const customers = await db
    .selectDistinct({ customerId: schema.feedback.customerId })
    .from(schema.feedback);

  const outcomes: HarvestOutcome[] = [];
  for (const { customerId } of customers) {
    outcomes.push(await harvestForCustomer(db, customerId));
  }

  logger.info(
    { customers: outcomes.length, shots: outcomes.reduce((n, o) => n + o.written, 0) },
    "few-shot harvest complete",
  );
  return outcomes;
}

export async function registerHarvest(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(HARVEST_QUEUE, HARVEST_QUEUE_OPTIONS);

  await boss.work(
    HARVEST_QUEUE,
    { batchSize: 1 },
    withOpsAlert(HARVEST_QUEUE, async () => {
      await runHarvest(db);
    }),
  );

  logger.info({ queue: HARVEST_QUEUE }, "few-shot harvest worker registered");
}
