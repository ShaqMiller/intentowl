/**
 * Classify job — drains undecided (item, watch) pairs in batches
 * (ARCHITECTURE.md section 7).
 *
 * The pre-filter runs first and for free, so most items never reach the model.
 * What survives goes to Haiku, and only the ambiguous band gets a second look
 * from Sonnet.
 *
 * Idempotent by construction: verdicts upsert on
 * `(item_id, watch_id, model)`, so a retried batch overwrites its own rows
 * rather than stacking duplicates, while still letting Haiku and Sonnet each
 * keep a verdict for the same pair.
 *
 * A pair is "undecided" when it has neither a classification nor a filter
 * verdict. Recording the filter's rejection is what stops the job starving:
 * without it, rejected pairs stay eligible forever and eventually fill every
 * slot in the per-run limit while the logs report success.
 */
import {
  applyFilter,
  createClassifier,
  estimateCostUsd,
  summarise,
  type Classifier,
  type CustomerProfile,
  type FewShot,
  type PromptItem,
} from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";

export const CLASSIFY_QUEUE = "classify";

/** Items per model call. Kept in one place so the eval can match production. */
export const BATCH_SIZE = 12;

/** Pairs drained per job execution, across all watches. */
const MAX_PER_RUN = 96;

/** Cap per watch so one high-volume customer cannot starve the rest. */
const MAX_PER_WATCH = 48;

/** Postgres caps bound parameters at 65535; stay far under it. */
const WRITE_CHUNK = 100;

export interface ClassifyOutcome {
  candidates: number;
  /** Dropped by the pre-filter before any model call. */
  filtered: number;
  classified: number;
  /** Items — not batches — sent to the escalation model. */
  escalated: number;
  costUsd: number;
  warnings: string[];
}

export interface RunClassifyOptions {
  db: Db;
  classifier: Classifier;
  /** Limit to one watch. Omit to drain across all of them. */
  watchId?: string;
  limit?: number;
  persist?: boolean;
}

export async function runClassify(
  options: RunClassifyOptions,
): Promise<ClassifyOutcome> {
  const { db, classifier } = options;
  const limit = options.limit ?? MAX_PER_RUN;
  const persist = options.persist ?? true;
  const log = logger.child(
    options.watchId === undefined ? {} : { watch_id: options.watchId },
  );

  const pending = await loadPending(db, limit, options.watchId);
  const outcome: ClassifyOutcome = {
    candidates: pending.length,
    filtered: 0,
    classified: 0,
    escalated: 0,
    costUsd: 0,
    warnings: [],
  };
  if (pending.length === 0) return outcome;

  // Group by watch: the prompt is per-customer, so a batch cannot span watches.
  const byWatch = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byWatch.get(row.watchId) ?? [];
    if (list.length >= MAX_PER_WATCH) continue;
    list.push(row);
    byWatch.set(row.watchId, list);
  }

  for (const [watchId, rows] of byWatch) {
    const context = await loadWatchContext(db, watchId);
    if (context === null) {
      outcome.warnings.push(`watch ${watchId} has no profile; skipped`);
      continue;
    }

    // The cost firewall: pure, free, and it drops most of the corpus.
    const verdicts = rows.map((row) =>
      applyFilter(
        { title: row.title, body: row.body, venue: row.venue, author: row.author },
        {
          includeTerms: context.includeTerms,
          excludeTerms: context.excludeTerms,
        },
      ),
    );
    const summary = summarise(verdicts);
    outcome.filtered += summary.dropped;
    log.info({ watch_id: watchId, ...summary }, "pre-filter complete");

    if (persist) {
      // Record the rejections before spending anything, so a crash mid-batch
      // still leaves them decided rather than eligible forever.
      await recordFilterVerdicts(
        db,
        rows.map((row, i) => ({ row, verdict: verdicts[i] })).filter(
          (x): x is { row: (typeof rows)[number]; verdict: NonNullable<(typeof verdicts)[number]> } =>
            x.verdict !== undefined && !x.verdict.keep,
        ),
      );
    }

    const kept = rows
      .map((row, i) => ({ row, verdict: verdicts[i] }))
      .filter((x) => x.verdict?.keep === true);
    if (kept.length === 0) continue;

    for (let i = 0; i < kept.length; i += BATCH_SIZE) {
      const batch = kept.slice(i, i + BATCH_SIZE);
      const items: PromptItem[] = batch.map(({ row, verdict }) => ({
        id: row.itemId,
        source: row.source,
        venue: row.venue,
        title: row.title,
        body: row.body,
        // Framed in the prompt as "why it reached you, not evidence of intent".
        matched: verdict?.matched ?? [],
      }));

      const result = await classifier.classify({
        profile: context.profile,
        items,
        ...(context.fewShots.length > 0 ? { fewShots: context.fewShots } : {}),
      });
      outcome.warnings.push(...result.warnings);
      outcome.costUsd += estimateCostUsd(result.usage);
      outcome.escalated += result.escalatedIds.length;

      if (!persist) {
        outcome.classified += result.classifications.length;
        continue;
      }

      const written = await writeClassifications(
        db,
        watchId,
        result.classifications,
        result.modelByItem,
      );
      outcome.classified += written;
      await recordUsage(db, context.customerId, result.usage);
    }
  }

  log.info(
    {
      candidates: outcome.candidates,
      filtered: outcome.filtered,
      classified: outcome.classified,
      escalated: outcome.escalated,
      cost_usd: Number(outcome.costUsd.toFixed(6)),
    },
    "classify complete",
  );
  return outcome;
}

// --- queue wiring -----------------------------------------------------------

export async function registerClassify(
  boss: PgBoss,
  db: Db,
  classifier: Classifier | null,
): Promise<void> {
  await boss.createQueue(CLASSIFY_QUEUE, {
    ...DEFAULT_QUEUE_OPTIONS,
    policy: "stately",
    expireInSeconds: 600,
  });

  if (classifier === null) {
    logger.warn(
      { queue: CLASSIFY_QUEUE },
      "no ANTHROPIC_API_KEY; classify queue created but not worked",
    );
    return;
  }

  await boss.work(CLASSIFY_QUEUE, { batchSize: 1 }, async () => {
    const outcome = await runClassify({ db, classifier });
    // Warnings were previously collected and never read. A degraded model
    // response is indistinguishable from success at the call site, so if
    // nothing surfaces them the cascade can quietly stop working.
    for (const warning of outcome.warnings) {
      logger.warn({ queue: CLASSIFY_QUEUE, warning }, "classify warning");
    }
  });

  logger.info({ queue: CLASSIFY_QUEUE }, "classify worker registered");
}

/** Built from env so a missing key disables classification rather than crashing. */
export function createWorkerClassifier(): Classifier | null {
  if (env.ANTHROPIC_API_KEY === undefined) return null;
  return createClassifier({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_WORKSPACE_ID === undefined
      ? {}
      : { workspaceId: env.ANTHROPIC_WORKSPACE_ID }),
  });
}

// --- persistence ------------------------------------------------------------

interface PendingRow {
  itemId: string;
  watchId: string;
  source: string;
  venue: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
}

/** (item, watch) pairs with neither a verdict nor a filter rejection. */
async function loadPending(
  db: Db,
  limit: number,
  watchId?: string,
): Promise<PendingRow[]> {
  const where = [
    isNull(schema.classifications.itemId),
    // Filtered pairs are decided. Without this they are re-selected forever.
    isNull(schema.itemWatches.filteredAt),
    // A paused or churned customer must cost nothing.
    eq(schema.watches.active, true),
  ];
  if (watchId !== undefined) {
    where.push(eq(schema.itemWatches.watchId, watchId));
  }

  return db
    .select({
      itemId: schema.itemWatches.itemId,
      watchId: schema.itemWatches.watchId,
      source: schema.items.source,
      venue: schema.items.venue,
      title: schema.items.title,
      body: schema.items.body,
      author: schema.items.author,
    })
    .from(schema.itemWatches)
    .innerJoin(schema.items, eq(schema.items.id, schema.itemWatches.itemId))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.itemWatches.watchId))
    .leftJoin(
      schema.classifications,
      and(
        eq(schema.classifications.itemId, schema.itemWatches.itemId),
        eq(schema.classifications.watchId, schema.itemWatches.watchId),
      ),
    )
    .where(and(...where))
    // Freshest first. A LIMIT over an unordered set is arbitrary, and a
    // three-day-old lead is worth much less than this morning's.
    .orderBy(desc(schema.items.postedAt))
    .limit(limit);
}

/** Mark rejected pairs as decided. One statement per chunk, not per row. */
async function recordFilterVerdicts(
  db: Db,
  rejected: readonly {
    row: { itemId: string; watchId: string };
    verdict: { reason: string | null };
  }[],
): Promise<void> {
  for (const chunk of chunked(rejected, WRITE_CHUNK)) {
    await db
      .insert(schema.itemWatches)
      .values(
        chunk.map(({ row, verdict }) => ({
          itemId: row.itemId,
          watchId: row.watchId,
          filteredAt: new Date(),
          filterReason: verdict.reason,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.itemWatches.itemId, schema.itemWatches.watchId],
        set: {
          filteredAt: sql`excluded.filtered_at`,
          filterReason: sql`excluded.filter_reason`,
        },
      });
  }
}

/** One statement per chunk. Was one awaited round trip per classification. */
async function writeClassifications(
  db: Db,
  watchId: string,
  classifications: readonly {
    item_id: string;
    relevant: boolean;
    intent: (typeof schema.intent.enumValues)[number];
    score: number;
    reason: string;
    reply_angle: string;
  }[],
  modelByItem: ReadonlyMap<string, string>,
): Promise<number> {
  let written = 0;
  for (const chunk of chunked(classifications, WRITE_CHUNK)) {
    const rows = chunk.map((c) => ({
      itemId: c.item_id,
      watchId,
      relevant: c.relevant,
      intent: c.intent,
      score: c.score,
      reason: c.reason,
      replyAngle: c.reply_angle,
      model: modelByItem.get(c.item_id) ?? "unknown",
    }));
    await db
      .insert(schema.classifications)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          schema.classifications.itemId,
          schema.classifications.watchId,
          schema.classifications.model,
        ],
        set: {
          relevant: sql`excluded.relevant`,
          intent: sql`excluded.intent`,
          score: sql`excluded.score`,
          reason: sql`excluded.reason`,
          replyAngle: sql`excluded.reply_angle`,
        },
      });
    written += rows.length;
  }
  return written;
}

interface WatchContext {
  customerId: string;
  includeTerms: string[];
  excludeTerms: string[];
  profile: CustomerProfile;
  fewShots: FewShot[];
}

async function loadWatchContext(
  db: Db,
  watchId: string,
): Promise<WatchContext | null> {
  const rows = await db
    .select({
      customerId: schema.watches.customerId,
      customerName: schema.customers.name,
      includeTerms: schema.watches.includeTerms,
      excludeTerms: schema.watches.excludeTerms,
      productDesc: schema.profiles.productDesc,
      icpDesc: schema.profiles.icpDesc,
      competitors: schema.profiles.competitors,
      disqualifiers: schema.profiles.disqualifiers,
      fewShotExamples: schema.profiles.fewShotExamples,
    })
    .from(schema.watches)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.watches.customerId))
    .leftJoin(schema.profiles, eq(schema.profiles.customerId, schema.watches.customerId))
    .where(eq(schema.watches.id, watchId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  // Without a product description the prompt has nothing to judge against,
  // and a generic verdict is worse than no verdict.
  if (row.productDesc === null || row.icpDesc === null) return null;

  return {
    customerId: row.customerId,
    includeTerms: row.includeTerms,
    excludeTerms: row.excludeTerms,
    profile: {
      name: row.customerName ?? "this customer",
      productDesc: row.productDesc,
      icpDesc: row.icpDesc,
      competitors: row.competitors ?? [],
      disqualifiers: row.disqualifiers ?? [],
    },
    // Harvested from this customer's own thumbs up/down (M6). Stored as jsonb,
    // so it is parsed defensively rather than trusted.
    fewShots: parseFewShots(row.fewShotExamples),
  };
}

function parseFewShots(value: unknown): FewShot[] {
  if (!Array.isArray(value)) return [];
  const out: FewShot[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e["title"] !== "string" || typeof e["reason"] !== "string") continue;
    out.push({
      title: e["title"],
      body: typeof e["body"] === "string" ? e["body"] : null,
      relevant: e["relevant"] === true,
      intent: (typeof e["intent"] === "string" ? e["intent"] : "none") as FewShot["intent"],
      score: typeof e["score"] === "number" ? e["score"] : 0,
      reason: e["reason"],
    });
  }
  // The rubric asks for 3-5; more dilutes and costs tokens on every call.
  return out.slice(0, 5);
}

/** Accumulated per model across the run, then written once per model. */
async function recordUsage(
  db: Db,
  customerId: string,
  usage: readonly {
    model: string;
    tokensIn: number;
    tokensOut: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }[],
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const byModel = new Map<string, { tokensIn: number; tokensOut: number; calls: number; cost: number }>();
  for (const entry of usage) {
    const acc = byModel.get(entry.model) ?? { tokensIn: 0, tokensOut: 0, calls: 0, cost: 0 };
    acc.tokensIn += entry.tokensIn + entry.cacheReadTokens + entry.cacheWriteTokens;
    acc.tokensOut += entry.tokensOut;
    acc.calls += 1;
    acc.cost += estimateCostUsd([entry]);
    byModel.set(entry.model, acc);
  }

  for (const [model, acc] of byModel) {
    await db
      .insert(schema.apiUsage)
      .values({
        customerId,
        source: model,
        calls: acc.calls,
        tokensIn: acc.tokensIn,
        tokensOut: acc.tokensOut,
        costUsd: acc.cost.toFixed(6),
        day,
      })
      .onConflictDoUpdate({
        target: [
          schema.apiUsage.customerId,
          schema.apiUsage.source,
          schema.apiUsage.day,
        ],
        set: {
          calls: sql`${schema.apiUsage.calls} + ${acc.calls}`,
          tokensIn: sql`${schema.apiUsage.tokensIn} + ${acc.tokensIn}`,
          tokensOut: sql`${schema.apiUsage.tokensOut} + ${acc.tokensOut}`,
          costUsd: sql`${schema.apiUsage.costUsd} + ${acc.cost.toFixed(6)}`,
        },
      });
  }
}

function* chunked<T>(input: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < input.length; i += size) {
    yield input.slice(i, i + size);
  }
}
