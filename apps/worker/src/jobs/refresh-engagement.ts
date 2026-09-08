/**
 * Engagement refresh (ARCHITECTURE.md section 7).
 *
 * Scoring weights engagement, but polling is cursor-driven and never revisits
 * a post: an item is scored on the points it had in the minute it was
 * discovered, which for a fresh thread is usually zero. A post that reaches the
 * front page three hours later keeps its cold score and gets ranked below
 * things nobody read.
 *
 * So this re-reads engagement for items still inside the digest's lookback
 * window, using each adapter's batch lookup. Sources without one — Lobsters
 * serves a story at a time, and the request budget does not justify it — are
 * skipped rather than polled item by item.
 *
 * Bounded on purpose: only items recent enough to still appear in a digest are
 * worth refreshing, because that is the only place the number is used.
 */
import type { EngagementRequest, SourceName } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";
import { notifyOps, withOpsAlert } from "../ops.ts";
import type { AdapterRegistry } from "./poll.ts";

export const REFRESH_QUEUE = "refresh-engagement";

export const REFRESH_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 600,
} as const;

/**
 * Matches the digest's own lookback. Refreshing anything older would cost
 * requests to update a number no digest will ever read.
 */
const WINDOW_HOURS = 36;

/** Ceiling per source per run, so one busy source cannot eat the budget. */
const MAX_ITEMS_PER_SOURCE = 300;

export interface RefreshOutcome {
  source: SourceName;
  considered: number;
  updated: number;
  calls: number;
  error?: string;
}

export async function runRefreshEngagement(
  db: Db,
  adapters: AdapterRegistry,
  now: Date = new Date(),
): Promise<RefreshOutcome[]> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
  const outcomes: RefreshOutcome[] = [];

  for (const [name, adapter] of Object.entries(adapters)) {
    if (adapter?.fetchEngagement === undefined) continue;
    const source = name as SourceName;

    // Only items actually linked to a watch: an item nobody is watching will
    // never appear in a digest, so its engagement does not matter.
    const rows = await db
      .selectDistinct({
        externalId: schema.items.externalId,
        venue: schema.items.venue,
      })
      .from(schema.items)
      .innerJoin(
        schema.itemWatches,
        eq(schema.itemWatches.itemId, schema.items.id),
      )
      .where(and(eq(schema.items.source, source), gte(schema.items.fetchedAt, since)))
      .limit(MAX_ITEMS_PER_SOURCE);

    if (rows.length === 0) {
      outcomes.push({ source, considered: 0, updated: 0, calls: 0 });
      continue;
    }

    const requests: EngagementRequest[] = rows.map((r) => ({
      externalId: r.externalId,
      venue: r.venue,
    }));

    try {
      const result = await adapter.fetchEngagement(requests);
      const updated = await applyEngagement(db, source, result.engagement);
      outcomes.push({
        source,
        considered: rows.length,
        updated,
        calls: result.cost.calls,
      });
    } catch (error) {
      // One source failing must not stop the others: a Stack Exchange quota
      // exhaustion should never cost HN its refresh.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ source, err: message }, "engagement refresh failed");
      outcomes.push({
        source,
        considered: rows.length,
        updated: 0,
        calls: 0,
        error: message,
      });
    }
  }

  const failed = outcomes.filter((o) => o.error !== undefined);
  if (failed.length > 0) {
    await notifyOps({
      level: "warn",
      title: "Engagement refresh degraded",
      lines: failed.map((f) => `${f.source}: ${f.error}`),
    });
  }

  logger.info(
    {
      sources: outcomes.length,
      updated: outcomes.reduce((n, o) => n + o.updated, 0),
      calls: outcomes.reduce((n, o) => n + o.calls, 0),
    },
    "engagement refresh complete",
  );
  return outcomes;
}

/**
 * Write the new engagement back.
 *
 * Only `engagement` is touched — never `fetchedAt`, which several queries use
 * as "how recently did we discover this", and never `postedAt`, which drives
 * the recency half-life. Refreshing a counter must not make an old post look
 * new.
 */
async function applyEngagement(
  db: Db,
  source: SourceName,
  engagement: Map<string, Record<string, unknown>>,
): Promise<number> {
  const entries = [...engagement.entries()];
  if (entries.length === 0) return 0;

  let updated = 0;
  const CHUNK = 100;

  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries.slice(i, i + CHUNK);

    // One statement per batch: a CASE over external_id rather than a hundred
    // round trips.
    const cases = sql.join(
      batch.map(
        ([externalId, value]) =>
          sql`when ${schema.items.externalId} = ${externalId} then ${JSON.stringify(value)}::jsonb`,
      ),
      sql` `,
    );

    const result = await db
      .update(schema.items)
      .set({ engagement: sql`case ${cases} else ${schema.items.engagement} end` })
      .where(
        and(
          eq(schema.items.source, source),
          inArray(
            schema.items.externalId,
            batch.map(([externalId]) => externalId),
          ),
        ),
      )
      .returning({ id: schema.items.id });

    updated += result.length;
  }

  return updated;
}

export async function registerRefreshEngagement(
  boss: PgBoss,
  db: Db,
  adapters: AdapterRegistry,
): Promise<void> {
  await boss.createQueue(REFRESH_QUEUE, REFRESH_QUEUE_OPTIONS);

  await boss.work(
    REFRESH_QUEUE,
    { batchSize: 1 },
    withOpsAlert(REFRESH_QUEUE, async () => {
      await runRefreshEngagement(db, adapters);
    }),
  );

  logger.info({ queue: REFRESH_QUEUE }, "engagement refresh worker registered");
}
