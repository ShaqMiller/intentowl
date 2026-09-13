/**
 * Lead feedback, shared by the dashboard buttons and the digest email links.
 *
 * Both paths end in the same row — `feedback (customer_id, item_id)` — which
 * the hourly few-shot harvest turns into calibration examples. One module so
 * the ownership check cannot exist on one path and be forgotten on the other.
 */
import type { FeedbackVerdict } from "@intentowl/core";
import { schema } from "@intentowl/db";
import { and, eq } from "drizzle-orm";

import { getDb } from "./db.ts";

export interface FeedbackTarget {
  title: string | null;
  body: string | null;
  /** What this customer has already said about the post, if anything. */
  verdict: FeedbackVerdict | null;
}

/**
 * The post, if it is reachable from one of this customer's watches.
 *
 * That join is the authorisation: a dashboard form field or a token names an
 * item, and only a link through `watches` proves it is this customer's lead.
 */
export async function loadFeedbackTarget(
  customerId: string,
  itemId: string,
): Promise<FeedbackTarget | null> {
  const rows = await getDb()
    .select({
      title: schema.items.title,
      body: schema.items.body,
      verdict: schema.feedback.verdict,
    })
    .from(schema.itemWatches)
    .innerJoin(schema.items, eq(schema.items.id, schema.itemWatches.itemId))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.itemWatches.watchId))
    .leftJoin(
      schema.feedback,
      and(
        eq(schema.feedback.itemId, schema.itemWatches.itemId),
        eq(schema.feedback.customerId, customerId),
      ),
    )
    .where(
      and(
        eq(schema.itemWatches.itemId, itemId),
        eq(schema.watches.customerId, customerId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Record a verdict, or clear it with null. Returns false when the item is not
 * this customer's, and writes nothing.
 */
export async function saveFeedback(
  customerId: string,
  itemId: string,
  verdict: FeedbackVerdict | null,
): Promise<boolean> {
  if ((await loadFeedbackTarget(customerId, itemId)) === null) return false;

  const db = getDb();
  const key = and(
    eq(schema.feedback.customerId, customerId),
    eq(schema.feedback.itemId, itemId),
  );

  if (verdict === null) {
    await db.delete(schema.feedback).where(key);
    return true;
  }

  await db
    .insert(schema.feedback)
    .values({ customerId, itemId, verdict })
    // Latest verdict wins. Someone who clicks down then up meant up.
    .onConflictDoUpdate({
      target: [schema.feedback.customerId, schema.feedback.itemId],
      set: { verdict, createdAt: new Date() },
    });
  return true;
}
