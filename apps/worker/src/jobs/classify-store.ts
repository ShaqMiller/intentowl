/**
 * Persistence shared by the synchronous and batch classification jobs.
 *
 * Both paths run the same pre-filter, build the same prompt and write the same
 * rows; only the transport differs. Keeping the storage in one module is what
 * stops the cheap path and the fast path drifting apart in ways that would only
 * show up as inconsistent data months later.
 */
import { estimateCostUsd, type CustomerProfile, type FewShot } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

/** Postgres caps bound parameters at 65535; stay far under it. */
const WRITE_CHUNK = 100;

export interface PendingRow {
  itemId: string;
  watchId: string;
  source: string;
  venue: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
}

/**
 * (item, watch) pairs with neither a verdict nor a filter rejection.
 *
 * Ordered newest-first: a LIMIT over an unordered set is arbitrary, and a
 * three-day-old lead is worth far less than this morning's.
 */
export async function loadPendingPairs(
  db: Db,
  limit: number,
  watchId?: string,
): Promise<PendingRow[]> {
  const where = [
    isNull(schema.classifications.itemId),
    // Filtered pairs are decided. Without this they are re-selected forever
    // and eventually fill every slot in the limit.
    isNull(schema.itemWatches.filteredAt),
    // A paused or churned customer must cost nothing.
    eq(schema.watches.active, true),
  ];
  if (watchId !== undefined) where.push(eq(schema.itemWatches.watchId, watchId));

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
    .orderBy(desc(schema.items.postedAt))
    .limit(limit);
}

/** Mark rejected pairs as decided. One statement per chunk, not per row. */
export async function recordFilterVerdicts(
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
export async function writeClassifications(
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

export interface WatchContext {
  customerId: string;
  includeTerms: string[];
  excludeTerms: string[];
  profile: CustomerProfile;
  fewShots: FewShot[];
}

export async function loadWatchContext(
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
    fewShots: parseFewShots(row.fewShotExamples),
  };
}

/** Stored as jsonb, so parsed defensively rather than trusted. */
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

/**
 * Accumulate usage per model, then write once per model.
 *
 * `discount` is the Batch API's 50% multiplier. It is applied here rather than
 * inside `estimateCostUsd` so the rate table stays the single source of truth
 * for list prices.
 */
export async function recordUsage(
  db: Db,
  customerId: string,
  usage: readonly {
    model: string;
    tokensIn: number;
    tokensOut: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }[],
  discount = 1,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const byModel = new Map<
    string,
    { tokensIn: number; tokensOut: number; calls: number; cost: number }
  >();

  for (const entry of usage) {
    const acc = byModel.get(entry.model) ?? {
      tokensIn: 0,
      tokensOut: 0,
      calls: 0,
      cost: 0,
    };
    // Cached tokens are billed too, so they belong in the recorded input
    // volume — otherwise api_usage under-reports the moment caching works.
    acc.tokensIn += entry.tokensIn + entry.cacheReadTokens + entry.cacheWriteTokens;
    acc.tokensOut += entry.tokensOut;
    acc.calls += 1;
    acc.cost += estimateCostUsd([entry]) * discount;
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

export function* chunked<T>(input: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < input.length; i += size) {
    yield input.slice(i, i + size);
  }
}
