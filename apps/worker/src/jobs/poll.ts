/**
 * Poll job — one execution is one watch against one source
 * (ARCHITECTURE.md section 7).
 *
 * Everything here is built to survive being run twice. Items upsert against
 * `UNIQUE(source, external_id)`, the watch link upserts against its composite
 * primary key, and the cursor only ever moves forward. A retry after a partial
 * failure re-fetches the same page and inserts nothing new.
 *
 * `runPoll` is a plain function so the CLI can call it directly without a
 * worker running; `registerPoll` wraps the same function as a queue handler.
 */
import {
  parseCursor,
  RateLimitedError,
  type Cursor,
  type SourceAdapter,
  type SourceName,
  type WatchConfig,
} from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";

export const POLL_QUEUE = "poll";

/**
 * Exported so the scheduler can create the queue too. Schedules are registered
 * from the CLI as well as the worker, and pg-boss refuses to schedule onto a
 * queue that does not exist yet.
 */
export const POLL_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  // One poll per (watch, source) may be queued and one may be running.
  // Without this a slow Reddit response builds a backlog that then stampedes.
  policy: "stately",
  expireInSeconds: 300,
} as const;

/** Postgres caps bound parameters at 65535; stay far under it. */
const INSERT_CHUNK = 200;

export interface PollJobData {
  watchId: string;
  source: SourceName;
}

export interface PollOutcome {
  watchId: string;
  source: SourceName;
  /** Items the adapter returned. */
  fetched: number;
  /** Rows that did not already exist in `items`. */
  inserted: number;
  /** Rows already present — the number the exit test wants at zero on re-run. */
  duplicates: number;
  /** New (item, watch) links created. */
  linked: number;
  /** HTTP requests issued, as recorded to `api_usage`. */
  calls: number;
  rateLimited: boolean;
  retryAfterSeconds?: number;
  /** Non-fatal problems the adapter reported. Logged, never swallowed. */
  warnings: string[];
}

export type AdapterRegistry = Partial<Record<SourceName, SourceAdapter>>;

export interface RunPollOptions {
  db: Db;
  adapters: AdapterRegistry;
  watchId: string;
  source: SourceName;
  /** When false, fetch and report but write nothing. Used by --dry-run. */
  persist?: boolean;
}

export async function runPoll(options: RunPollOptions): Promise<PollOutcome> {
  const { db, adapters, watchId, source } = options;
  const persist = options.persist ?? true;
  const log = logger.child({ watch_id: watchId, source });

  const adapter = adapters[source];
  if (adapter === undefined) {
    throw new Error(
      `no adapter configured for source "${source}" — check the credentials in .env`,
    );
  }

  const watch = await loadWatch(db, watchId);
  if (!watch.active) {
    log.info("watch is inactive; skipping");
    return emptyOutcome(watchId, source);
  }

  const previous = await loadCursor(db, watchId, source);

  let result;
  try {
    result = await adapter.fetchNew(watch.config, previous);
  } catch (error) {
    // A 429 is not a failure to retry in-process — it is an instruction to come
    // back later. Report it so the caller can reschedule instead of hammering.
    if (error instanceof RateLimitedError) {
      log.warn(
        { retry_after_s: error.retryAfterSeconds },
        "rate limited; rescheduling",
      );
      return {
        ...emptyOutcome(watchId, source),
        rateLimited: true,
        retryAfterSeconds: error.retryAfterSeconds,
      };
    }
    throw error;
  }

  const outcome: PollOutcome = {
    ...emptyOutcome(watchId, source),
    fetched: result.items.length,
    calls: result.cost.calls,
    warnings: result.warnings ?? [],
  };

  // Adapters raise warnings for the failures that do not throw: a query too
  // broad to cover in one window, a shared quota running down, a misconfigured
  // site skipped so the rest of the poll survives. Every one of them looks
  // exactly like a quiet day if nothing surfaces it.
  for (const warning of outcome.warnings) {
    log.warn({ warning }, "adapter warning");
  }

  if (!persist) {
    log.info(
      { fetched: outcome.fetched, calls: outcome.calls },
      "poll complete (dry run, nothing written)",
    );
    return outcome;
  }

  // Cost is recorded even when the fetch returned nothing: per-customer unit
  // economics has to count the calls that found no leads too.
  await recordUsage(db, watch.customerId, source, result.cost.calls);

  if (result.items.length > 0) {
    const externalIds = result.items.map((item) => item.externalId);
    const alreadyKnown = await countKnown(db, source, externalIds);

    const itemIds = await upsertItems(db, result.items);
    outcome.inserted = itemIds.length - alreadyKnown;
    outcome.duplicates = alreadyKnown;
    outcome.linked = await linkToWatch(db, itemIds, watchId);
  }

  // Advance the cursor last. If anything above threw, the next run re-fetches
  // the same page — which the unique index makes free.
  if (result.nextCursor !== null) {
    await saveCursor(db, watchId, source, result.nextCursor);
  }

  log.info(
    {
      fetched: outcome.fetched,
      inserted: outcome.inserted,
      duplicates: outcome.duplicates,
      linked: outcome.linked,
      calls: outcome.calls,
    },
    "poll complete",
  );
  return outcome;
}

// --- queue wiring -----------------------------------------------------------

export async function registerPoll(
  boss: PgBoss,
  db: Db,
  adapters: AdapterRegistry,
): Promise<void> {
  await boss.createQueue(POLL_QUEUE, POLL_QUEUE_OPTIONS);

  await boss.work<PollJobData>(POLL_QUEUE, { batchSize: 1 }, async (jobs) => {
    // Returned so pg-boss stores it as the job's output. Fetched counts and
    // warnings were only ever logged, which is how a source that returned
    // nothing for a week looked like a column of successful jobs. The
    // watchdog reads these to tell a quiet source from a broken one.
    let last: PollOutcome | undefined;
    for (const job of jobs) {
      const outcome = await runPoll({
        db,
        adapters,
        watchId: job.data.watchId,
        source: job.data.source,
      });

      if (outcome.rateLimited) {
        // Re-enqueue rather than throw: a 429 is expected traffic shaping, not
        // an error, and burning a retry attempt on it would be wrong.
        await boss.send(POLL_QUEUE, job.data, {
          startAfter: outcome.retryAfterSeconds ?? 60,
          singletonKey: pollSingletonKey(job.data),
        });
      }
      last = outcome;
    }
    return last;
  });

  logger.info({ queue: POLL_QUEUE }, "poll worker registered");
}

/** Stops overlapping polls of the same watch and source. */
export function pollSingletonKey(data: PollJobData): string {
  return `${data.watchId}:${data.source}`;
}

// --- persistence ------------------------------------------------------------

interface LoadedWatch {
  active: boolean;
  customerId: string;
  config: WatchConfig;
}

async function loadWatch(db: Db, watchId: string): Promise<LoadedWatch> {
  const rows = await db
    .select()
    .from(schema.watches)
    .where(eq(schema.watches.id, watchId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error(`watch ${watchId} not found`);

  return {
    active: row.active,
    customerId: row.customerId,
    config: {
      id: row.id,
      customerId: row.customerId,
      name: row.name,
      sources: row.sources,
      subreddits: row.subreddits,
      includeTerms: row.includeTerms,
      excludeTerms: row.excludeTerms,
      // Per-source settings: which Stack Exchange sites, which RSS feeds.
      // Without this the adapters silently fall back to their defaults and a
      // customer's configuration has no effect at all.
      sourceConfig: row.sourceConfig,
    },
  };
}

async function loadCursor(
  db: Db,
  watchId: string,
  source: SourceName,
): Promise<Cursor | null> {
  const rows = await db
    .select({ cursor: schema.cursors.cursor })
    .from(schema.cursors)
    .where(
      and(
        eq(schema.cursors.watchId, watchId),
        eq(schema.cursors.source, source),
      ),
    )
    .limit(1);
  return parseCursor(rows[0]?.cursor);
}

async function saveCursor(
  db: Db,
  watchId: string,
  source: SourceName,
  value: Cursor,
): Promise<void> {
  await db
    .insert(schema.cursors)
    .values({ watchId, source, cursor: value })
    .onConflictDoUpdate({
      target: [schema.cursors.watchId, schema.cursors.source],
      set: { cursor: value, updatedAt: sql`now()` },
    });
}

/** How many of these external ids we have already stored. */
async function countKnown(
  db: Db,
  source: SourceName,
  externalIds: string[],
): Promise<number> {
  let known = 0;
  for (const chunk of chunked(externalIds, INSERT_CHUNK)) {
    const rows = await db
      .select({ externalId: schema.items.externalId })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.source, source),
          inArray(schema.items.externalId, chunk),
        ),
      );
    known += rows.length;
  }
  return known;
}

async function upsertItems(
  db: Db,
  items: readonly {
    source: SourceName;
    externalId: string;
    url: string;
    author: string | null;
    title: string | null;
    body: string | null;
    venue: string | null;
    postedAt: Date | null;
    engagement: Record<string, unknown> | null;
  }[],
): Promise<string[]> {
  const ids: string[] = [];

  for (const chunk of chunked(items, INSERT_CHUNK)) {
    const rows = await db
      .insert(schema.items)
      .values([...chunk])
      .onConflictDoUpdate({
        target: [schema.items.source, schema.items.externalId],
        // Refresh what changes over a post's life — scores and edits — and
        // leave identity alone. DO UPDATE (not DO NOTHING) so RETURNING still
        // yields a row for items we already had, which we need for the link.
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          url: sql`excluded.url`,
          // Refreshed too: venue derivation is adapter logic, and when a bug in
          // it is fixed, re-polling should heal the rows it got wrong rather
          // than leaving them permanently unweightable.
          venue: sql`excluded.venue`,
          engagement: sql`excluded.engagement`,
          fetchedAt: sql`now()`,
        },
      })
      .returning({ id: schema.items.id });

    for (const row of rows) ids.push(row.id);
  }

  return ids;
}

/** Returns how many links were newly created. */
async function linkToWatch(
  db: Db,
  itemIds: readonly string[],
  watchId: string,
): Promise<number> {
  let created = 0;
  for (const chunk of chunked(itemIds, INSERT_CHUNK)) {
    const rows = await db
      .insert(schema.itemWatches)
      .values(chunk.map((itemId) => ({ itemId, watchId })))
      .onConflictDoNothing()
      .returning({ itemId: schema.itemWatches.itemId });
    created += rows.length;
  }
  return created;
}

async function recordUsage(
  db: Db,
  customerId: string,
  source: SourceName,
  calls: number,
): Promise<void> {
  if (calls === 0) return;
  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(schema.apiUsage)
    .values({ customerId, source, calls, day })
    .onConflictDoUpdate({
      target: [
        schema.apiUsage.customerId,
        schema.apiUsage.source,
        schema.apiUsage.day,
      ],
      // Accumulate into the day's row rather than fanning out new ones.
      set: { calls: sql`${schema.apiUsage.calls} + ${calls}` },
    });
}

// --- helpers ----------------------------------------------------------------

function emptyOutcome(watchId: string, source: SourceName): PollOutcome {
  return {
    watchId,
    source,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    linked: 0,
    calls: 0,
    rateLimited: false,
    warnings: [],
  };
}

function* chunked<T>(input: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < input.length; i += size) {
    yield input.slice(i, i + size);
  }
}
