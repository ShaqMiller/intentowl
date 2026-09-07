/**
 * Overnight batch classification (ARCHITECTURE.md section 4.3).
 *
 * The same pipeline as `classify.ts` — same pre-filter, same prompt, same
 * cascade — submitted through the Batch API for half the price. Latency goes
 * from seconds to (usually) minutes, which costs a daily digest nothing.
 *
 * The job is its own state machine, and pg-boss is the durable store for it:
 *
 *   {stage:"haiku"}                 gather, filter, submit  -> reschedule
 *   {stage:"haiku", batchId}        poll; ended? write, then submit Sonnet
 *   {stage:"sonnet", batchId}       poll; ended? write, done
 *
 * No extra table is needed because the batch id lives in `pgboss.job.data`,
 * which survives a worker being killed: the row stays `active`, the supervisor
 * expires it back to `created`, and the next worker resumes with the same
 * payload. Losing a submitted batch would mean paying for work never collected.
 */
import {
  applyFilter,
  collectBatch,
  estimateCostUsd,
  getBatchState,
  submitBatch,
  summarise,
  BATCH_DISCOUNT,
  ESCALATION_BAND,
  HAIKU_MODEL,
  SONNET_MODEL,
  type BatchGroup,
  type PromptItem,
} from "@intentowl/core";
import type Anthropic from "@anthropic-ai/sdk";
import { schema, type Db } from "@intentowl/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";
import {
  loadPendingPairs,
  loadWatchContext,
  recordFilterVerdicts,
  recordUsage,
  writeClassifications,
} from "./classify-store.ts";

export const CLASSIFY_BATCH_QUEUE = "classify-batch";

/** Pairs submitted per overnight run. */
const MAX_PER_RUN = 500;

/** How often to check a submitted batch. Batches usually finish in minutes. */
const POLL_INTERVAL_SECONDS = 120;

export type BatchStage = "haiku" | "sonnet";

export interface ClassifyBatchData {
  stage: BatchStage;
  /** Absent on the first run of a stage: that run submits. */
  batchId?: string;
  /** Guards against polling a stuck batch forever. */
  polls?: number;
}

/** 24h of polling at the configured interval, then give up loudly. */
const MAX_POLLS = Math.ceil((24 * 60 * 60) / POLL_INTERVAL_SECONDS);

export async function registerClassifyBatch(
  boss: PgBoss,
  db: Db,
  client: Anthropic | null,
): Promise<void> {
  await boss.createQueue(CLASSIFY_BATCH_QUEUE, {
    ...DEFAULT_QUEUE_OPTIONS,
    policy: "stately",
    // A poll is seconds; a submission of 500 items is still under a minute.
    expireInSeconds: 300,
  });

  if (client === null) {
    logger.warn(
      { queue: CLASSIFY_BATCH_QUEUE },
      "no ANTHROPIC_API_KEY; batch classify queue created but not worked",
    );
    return;
  }

  await boss.work<ClassifyBatchData>(
    CLASSIFY_BATCH_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await step(boss, db, client, job.data);
      }
    },
  );

  logger.info({ queue: CLASSIFY_BATCH_QUEUE }, "batch classify worker registered");
}

/** Kick off an overnight run. Safe to call repeatedly — the queue is stately. */
export async function startBatchRun(boss: PgBoss): Promise<string | null> {
  return boss.send(
    CLASSIFY_BATCH_QUEUE,
    { stage: "haiku" } satisfies ClassifyBatchData,
    { singletonKey: "classify-batch-run" },
  );
}

async function step(
  boss: PgBoss,
  db: Db,
  client: Anthropic,
  data: ClassifyBatchData,
): Promise<void> {
  const log = logger.child({ queue: CLASSIFY_BATCH_QUEUE, stage: data.stage });

  if (data.batchId === undefined) {
    await submitStage(boss, db, client, data.stage, log);
    return;
  }

  const { state, counts } = await getBatchState(client, data.batchId);
  if (state === "in_progress") {
    const polls = (data.polls ?? 0) + 1;
    if (polls > MAX_POLLS) {
      // Do not poll forever in silence. Failing surfaces it in pg-boss's
      // failed state, which ops-daily reports.
      throw new Error(
        `batch ${data.batchId} still in progress after ${polls} polls (~24h)`,
      );
    }
    log.info({ batch_id: data.batchId, polls, counts }, "batch still processing");
    await boss.send(
      CLASSIFY_BATCH_QUEUE,
      { ...data, polls },
      {
        startAfter: POLL_INTERVAL_SECONDS,
        singletonKey: `classify-batch-${data.batchId}`,
      },
    );
    return;
  }

  await collectStage(boss, db, client, data.stage, data.batchId, log);
}

// --- submit -----------------------------------------------------------------

async function submitStage(
  boss: PgBoss,
  db: Db,
  client: Anthropic,
  stage: BatchStage,
  log: typeof logger,
): Promise<void> {
  const groups =
    stage === "haiku"
      ? await gatherHaikuGroups(db, log)
      : await gatherSonnetGroups(db, log);

  if (groups.length === 0) {
    log.info("nothing to classify; batch run complete");
    return;
  }

  const model = stage === "haiku" ? HAIKU_MODEL : SONNET_MODEL;
  const submitted = await submitBatch(client, model, groups, {
    // Same rule as the synchronous path: Haiku has no thinking to disable.
    disableThinking: stage === "sonnet",
  });
  if (submitted === null) {
    log.info("no requests built; batch run complete");
    return;
  }

  log.info(
    {
      batch_id: submitted.batchId,
      requests: submitted.requestCount,
      items: submitted.itemCount,
      model,
    },
    "batch submitted",
  );

  await boss.send(
    CLASSIFY_BATCH_QUEUE,
    { stage, batchId: submitted.batchId, polls: 0 } satisfies ClassifyBatchData,
    {
      startAfter: 30,
      singletonKey: `classify-batch-${submitted.batchId}`,
    },
  );
}

/** Undecided pairs, pre-filtered, grouped by watch. */
async function gatherHaikuGroups(
  db: Db,
  log: typeof logger,
): Promise<BatchGroup[]> {
  const pending = await loadPendingPairs(db, MAX_PER_RUN);
  if (pending.length === 0) return [];

  const byWatch = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byWatch.get(row.watchId) ?? [];
    list.push(row);
    byWatch.set(row.watchId, list);
  }

  const groups: BatchGroup[] = [];
  for (const [watchId, rows] of byWatch) {
    const context = await loadWatchContext(db, watchId);
    if (context === null) continue;

    const verdicts = rows.map((row) =>
      applyFilter(
        { title: row.title, body: row.body, venue: row.venue, author: row.author },
        {
          includeTerms: context.includeTerms,
          excludeTerms: context.excludeTerms,
        },
      ),
    );
    log.info({ watch_id: watchId, ...summarise(verdicts) }, "pre-filter complete");

    // Record rejections before spending: a crash mid-run must still leave them
    // decided, or the queue silently starves.
    await recordFilterVerdicts(
      db,
      rows
        .map((row, i) => ({ row, verdict: verdicts[i] }))
        .filter((x) => x.verdict !== undefined && !x.verdict.keep)
        .map((x) => ({ row: x.row, verdict: { reason: x.verdict?.reason ?? null } })),
    );

    const items: PromptItem[] = rows
      .map((row, i) => ({ row, verdict: verdicts[i] }))
      .filter((x) => x.verdict?.keep === true)
      .map(({ row, verdict }) => ({
        id: row.itemId,
        source: row.source,
        venue: row.venue,
        title: row.title,
        body: row.body,
        matched: verdict?.matched ?? [],
      }));

    if (items.length === 0) continue;
    groups.push({
      watchId,
      request: {
        profile: context.profile,
        items,
        ...(context.fewShots.length > 0 ? { fewShots: context.fewShots } : {}),
      },
    });
  }

  return groups;
}

/** Items Haiku left in the ambiguous band, read back from the database. */
async function gatherSonnetGroups(
  db: Db,
  log: typeof logger,
): Promise<BatchGroup[]> {
  const rows = await db
    .select({
      itemId: schema.classifications.itemId,
      watchId: schema.classifications.watchId,
      source: schema.items.source,
      venue: schema.items.venue,
      title: schema.items.title,
      body: schema.items.body,
    })
    .from(schema.classifications)
    .innerJoin(schema.items, eq(schema.items.id, schema.classifications.itemId))
    .where(
      and(
        eq(schema.classifications.model, HAIKU_MODEL),
        sql`${schema.classifications.score} between ${ESCALATION_BAND.min} and ${ESCALATION_BAND.max}`,
        // Only pairs Sonnet has not already ruled on.
        sql`not exists (
          select 1 from ${schema.classifications} s
          where s.item_id = ${schema.classifications.itemId}
            and s.watch_id = ${schema.classifications.watchId}
            and s.model = ${SONNET_MODEL}
        )`,
      ),
    )
    .orderBy(desc(schema.items.postedAt))
    .limit(MAX_PER_RUN);

  if (rows.length === 0) return [];
  log.info({ items: rows.length }, "escalating to the batch Sonnet pass");

  const byWatch = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byWatch.get(row.watchId) ?? [];
    list.push(row);
    byWatch.set(row.watchId, list);
  }

  const groups: BatchGroup[] = [];
  for (const [watchId, watchRows] of byWatch) {
    const context = await loadWatchContext(db, watchId);
    if (context === null) continue;
    groups.push({
      watchId,
      request: {
        profile: context.profile,
        items: watchRows.map((row) => ({
          id: row.itemId,
          source: row.source,
          venue: row.venue,
          title: row.title,
          body: row.body,
        })),
        ...(context.fewShots.length > 0 ? { fewShots: context.fewShots } : {}),
      },
    });
  }
  return groups;
}

// --- collect ----------------------------------------------------------------

async function collectStage(
  boss: PgBoss,
  db: Db,
  client: Anthropic,
  stage: BatchStage,
  batchId: string,
  log: typeof logger,
): Promise<void> {
  const model = stage === "haiku" ? HAIKU_MODEL : SONNET_MODEL;
  const collected = await collectBatch(client, model, batchId);

  for (const warning of collected.warnings) {
    log.warn({ batch_id: batchId, warning }, "batch warning");
  }

  // Never trust ids echoed by a model: keep only pairs that genuinely exist.
  const byWatch = new Map<string, typeof collected.verdicts>();
  for (const v of collected.verdicts) {
    const list = byWatch.get(v.watchId) ?? [];
    list.push(v);
    byWatch.set(v.watchId, list);
  }

  let written = 0;
  for (const [watchId, verdicts] of byWatch) {
    const claimed = verdicts.map((v) => v.classification.item_id);
    const real = new Set(
      (
        await db
          .select({ itemId: schema.itemWatches.itemId })
          .from(schema.itemWatches)
          .where(
            and(
              eq(schema.itemWatches.watchId, watchId),
              inArray(schema.itemWatches.itemId, claimed),
            ),
          )
      ).map((r) => r.itemId),
    );

    const valid = verdicts.filter((v) => real.has(v.classification.item_id));
    if (valid.length < verdicts.length) {
      log.warn(
        { watch_id: watchId, dropped: verdicts.length - valid.length },
        "batch returned item ids not linked to this watch",
      );
    }
    if (valid.length === 0) continue;

    const modelByItem = new Map(
      valid.map((v) => [v.classification.item_id, model] as const),
    );
    written += await writeClassifications(
      db,
      watchId,
      valid.map((v) => v.classification),
      modelByItem,
    );

    const context = await loadWatchContext(db, watchId);
    if (context !== null) {
      // Batch pricing is half the synchronous rate on input and output alike.
      await recordUsage(db, context.customerId, collected.usage, BATCH_DISCOUNT);
    }
  }

  const gross = estimateCostUsd(collected.usage);
  log.info(
    {
      batch_id: batchId,
      written,
      cost_usd: Number((gross * BATCH_DISCOUNT).toFixed(6)),
      saved_usd: Number((gross * (1 - BATCH_DISCOUNT)).toFixed(6)),
    },
    "batch collected",
  );

  // Haiku done, so hand the ambiguous band to Sonnet as a second batch.
  if (stage === "haiku") {
    await boss.send(
      CLASSIFY_BATCH_QUEUE,
      { stage: "sonnet" } satisfies ClassifyBatchData,
      { startAfter: 5, singletonKey: "classify-batch-sonnet" },
    );
  }
}

/** Exposed so the CLI can drain pairs without a running worker. */
export { loadPendingPairs, isNull };
