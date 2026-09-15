/**
 * Data retention.
 *
 * Reddit content is kept for 30 days, then deleted. Reddit's Data API terms
 * expect stored content not to outlive its use, and 30 days is well past the
 * digest's 36-hour lookback and the dashboard's seven days — long enough for a
 * customer to come back to a lead, short enough to be a real limit. The
 * privacy policy and the Reddit access request both state this number, so it
 * lives in one constant.
 *
 * Deleting an item cascades to its classifications, digest entries and
 * feedback, which is intended: a lead whose source text is gone should not
 * linger as a verdict about nothing.
 */
import { schema, type Db } from "@intentowl/db";
import { and, eq, lt } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";
import { withOpsAlert } from "../ops.ts";

export const RETENTION_QUEUE = "retention";

export const RETENTION_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 300,
} as const;

export const REDDIT_RETENTION_DAYS = 30;

export async function runRetention(
  db: Db,
  now: Date = new Date(),
): Promise<{ redditItemsDeleted: number }> {
  const cutoff = new Date(now.getTime() - REDDIT_RETENTION_DAYS * 86_400_000);
  const deleted = await db
    .delete(schema.items)
    .where(and(eq(schema.items.source, "reddit"), lt(schema.items.fetchedAt, cutoff)))
    .returning({ id: schema.items.id });
  return { redditItemsDeleted: deleted.length };
}

export async function registerRetention(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(RETENTION_QUEUE, RETENTION_QUEUE_OPTIONS);

  await boss.work(
    RETENTION_QUEUE,
    { batchSize: 1 },
    withOpsAlert(RETENTION_QUEUE, async () => {
      const outcome = await runRetention(db);
      if (outcome.redditItemsDeleted > 0) logger.info(outcome, "retention applied");
    }),
  );

  logger.info({ queue: RETENTION_QUEUE }, "retention worker registered");
}
