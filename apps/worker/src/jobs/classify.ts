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
  type PromptItem,
} from "@intentowl/core";
import Anthropic from "@anthropic-ai/sdk";
import { type Db } from "@intentowl/db";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import {
  loadPendingPairs,
  loadWatchContext,
  recordFilterVerdicts,
  recordUsage,
  writeClassifications,
} from "./classify-store.ts";

export const CLASSIFY_QUEUE = "classify";

/** Exported so the scheduler can create the queue before scheduling onto it. */
export const CLASSIFY_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 600,
} as const;

/** Items per model call. Kept in one place so the eval can match production. */
export const BATCH_SIZE = 12;

/** Pairs drained per job execution, across all watches. */
const MAX_PER_RUN = 96;

/** Cap per watch so one high-volume customer cannot starve the rest. */
const MAX_PER_WATCH = 48;

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

  const pending = await loadPendingPairs(db, limit, options.watchId);
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
  await boss.createQueue(CLASSIFY_QUEUE, CLASSIFY_QUEUE_OPTIONS);

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

/** Raw SDK client for the Batch API path, or null when unconfigured. */
export function createAnthropicClient(): Anthropic | null {
  if (env.ANTHROPIC_API_KEY === undefined) return null;
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    ...(env.ANTHROPIC_WORKSPACE_ID === undefined
      ? {}
      : { defaultHeaders: { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } }),
  });
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

// Persistence lives in ./classify-store.ts, shared with the batch path.
