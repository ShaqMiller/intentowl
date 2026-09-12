/**
 * Read queries for the dashboard.
 *
 * Every one of these takes a customerId and joins through `watches` to reach
 * the data, so a customer can only ever see rows reachable from their own
 * watches. That join is the authorisation check — there is no other guard
 * between a URL and the database, so never add a query here that skips it.
 */
import { schema } from "@intentowl/db";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "./db.ts";

export interface DashboardLead {
  itemId: string;
  score: number;
  intent: string;
  reason: string | null;
  replyAngle: string | null;
  title: string | null;
  url: string;
  source: string;
  venue: string | null;
  author: string | null;
  postedAt: Date | null;
  watchId: string;
  watchName: string;
}

export interface LeadFilters {
  /** Restrict to one watch. Undefined means every watch this customer owns. */
  watchId?: string | undefined;
  intent?: string | undefined;
  /** How far back to look, in days. */
  days?: number | undefined;
}

export async function listLeads(
  customerId: string,
  filters: LeadFilters = {},
): Promise<DashboardLead[]> {
  const db = getDb();
  const days = filters.days ?? 7;
  const since = new Date(Date.now() - days * 86_400_000);

  const conditions = [
    eq(schema.watches.customerId, customerId),
    eq(schema.classifications.relevant, true),
    gte(schema.items.fetchedAt, since),
  ];
  if (filters.watchId !== undefined) {
    conditions.push(eq(schema.classifications.watchId, filters.watchId));
  }
  if (filters.intent !== undefined) {
    conditions.push(
      eq(schema.classifications.intent, filters.intent as "buying_intent"),
    );
  }

  const rows = await db
    .select({
      itemId: schema.items.id,
      score: schema.classifications.score,
      intent: schema.classifications.intent,
      reason: schema.classifications.reason,
      replyAngle: schema.classifications.replyAngle,
      title: schema.items.title,
      url: schema.items.url,
      source: schema.items.source,
      venue: schema.items.venue,
      author: schema.items.author,
      postedAt: schema.items.postedAt,
      watchId: schema.watches.id,
      watchName: schema.watches.name,
    })
    .from(schema.classifications)
    .innerJoin(schema.items, eq(schema.items.id, schema.classifications.itemId))
    .innerJoin(
      schema.watches,
      eq(schema.watches.id, schema.classifications.watchId),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.classifications.score))
    .limit(300);

  // A pair can carry both a Haiku and a Sonnet verdict. Show one row per item,
  // keeping the higher score — that is the escalated one.
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = best.get(row.itemId);
    if (existing === undefined || row.score > existing.score) {
      best.set(row.itemId, row);
    }
  }
  return [...best.values()];
}

export interface WatchSummary {
  id: string;
  name: string;
  sources: string[];
  subreddits: string[];
  includeTerms: string[];
  excludeTerms: string[];
  active: boolean;
  createdAt: Date;
  /** Relevant leads found in the last 7 days. */
  leadCount: number;
}

export async function listWatches(customerId: string): Promise<WatchSummary[]> {
  const db = getDb();
  const since = new Date(Date.now() - 7 * 86_400_000);

  const watches = await db
    .select()
    .from(schema.watches)
    .where(eq(schema.watches.customerId, customerId))
    .orderBy(schema.watches.createdAt);

  // One grouped count rather than a query per watch: a customer with a dozen
  // watches would otherwise cost a dozen round trips on every page load.
  const counts = await db
    .select({
      watchId: schema.classifications.watchId,
      n: count(sql`distinct ${schema.classifications.itemId}`),
    })
    .from(schema.classifications)
    .innerJoin(
      schema.watches,
      eq(schema.watches.id, schema.classifications.watchId),
    )
    .where(
      and(
        eq(schema.watches.customerId, customerId),
        eq(schema.classifications.relevant, true),
        gte(schema.classifications.createdAt, since),
      ),
    )
    .groupBy(schema.classifications.watchId);

  const byWatch = new Map(counts.map((c) => [c.watchId, Number(c.n)]));

  return watches.map((w) => ({
    id: w.id,
    name: w.name,
    sources: w.sources,
    subreddits: w.subreddits,
    includeTerms: w.includeTerms,
    excludeTerms: w.excludeTerms,
    active: w.active,
    createdAt: w.createdAt,
    leadCount: byWatch.get(w.id) ?? 0,
  }));
}

/** One watch, scoped to its owner. Returns null rather than throwing on a bad id. */
export async function getWatch(customerId: string, watchId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.watches)
    .where(
      and(
        eq(schema.watches.id, watchId),
        eq(schema.watches.customerId, customerId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getProfile(customerId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.customerId, customerId))
    .limit(1);
  return rows[0] ?? null;
}

export interface DashboardStats {
  leads7d: number;
  leads24h: number;
  scanned24h: number;
  activeWatches: number;
}

export async function getStats(customerId: string): Promise<DashboardStats> {
  const db = getDb();
  const day = new Date(Date.now() - 86_400_000);
  const week = new Date(Date.now() - 7 * 86_400_000);

  const [relevantWeek, relevantDay, scanned, watches] = await Promise.all([
    db
      .select({ n: count(sql`distinct ${schema.classifications.itemId}`) })
      .from(schema.classifications)
      .innerJoin(
        schema.watches,
        eq(schema.watches.id, schema.classifications.watchId),
      )
      .where(
        and(
          eq(schema.watches.customerId, customerId),
          eq(schema.classifications.relevant, true),
          gte(schema.classifications.createdAt, week),
        ),
      ),
    db
      .select({ n: count(sql`distinct ${schema.classifications.itemId}`) })
      .from(schema.classifications)
      .innerJoin(
        schema.watches,
        eq(schema.watches.id, schema.classifications.watchId),
      )
      .where(
        and(
          eq(schema.watches.customerId, customerId),
          eq(schema.classifications.relevant, true),
          gte(schema.classifications.createdAt, day),
        ),
      ),
    // Everything the pollers attached to this customer's watches in 24h,
    // classified or filtered — the honest denominator for "posts read".
    db
      .select({ n: count() })
      .from(schema.itemWatches)
      .innerJoin(
        schema.watches,
        eq(schema.watches.id, schema.itemWatches.watchId),
      )
      .where(
        and(
          eq(schema.watches.customerId, customerId),
          gte(schema.itemWatches.createdAt, day),
        ),
      ),
    db
      .select({ n: count() })
      .from(schema.watches)
      .where(
        and(
          eq(schema.watches.customerId, customerId),
          eq(schema.watches.active, true),
        ),
      ),
  ]);

  return {
    leads7d: Number(relevantWeek[0]?.n ?? 0),
    leads24h: Number(relevantDay[0]?.n ?? 0),
    scanned24h: Number(scanned[0]?.n ?? 0),
    activeWatches: Number(watches[0]?.n ?? 0),
  };
}

/**
 * Aggregate liveness figures for the public landing page.
 *
 * Deliberately carries no content and no customer scoping: counts and
 * timestamps only. A feed of the actual posts would publish a list of real
 * people being targeted for sales outreach, and would leak the search terms
 * customers pay to have worked out. Neither is worth the credibility a moving
 * number already buys.
 */
/** Sources that genuinely poll. Reddit is absent until its API is approved. */
const LIVE_SOURCES = ["hn", "lobsters", "stackexchange", "bluesky", "rss"] as const;

export interface PublicActivity {
  /** Posts read across every source in the last 24 hours. */
  postsRead24h: number;
  /** Posts read since the beginning, for the larger number. */
  postsReadTotal: number;
  /**
   * When each source was last *polled*, not when it last returned something.
   *
   * Those are different questions and only the first one is about liveness. A
   * source can be checked every hour and return nothing for days — Stack
   * Exchange does exactly that for a watch about finding customers, because
   * nobody asks that on a technical Q&A site. Showing the last result would
   * read as an outage when the system is working perfectly.
   */
  sources: Array<{ source: string; lastPolledAt: Date | null }>;
}

export async function getPublicActivity(): Promise<PublicActivity | null> {
  // The landing page must render whether or not the database answers. A
  // marketing page that 500s because a stats widget could not reach Postgres
  // is a far worse outcome than one without the widget.
  try {
    const db = getDb();
    const since = new Date(Date.now() - 86_400_000);

    const [recent, total, polls] = await Promise.all([
      db
        .select({ n: count() })
        .from(schema.items)
        .where(gte(schema.items.fetchedAt, since)),
      db.select({ n: count() }).from(schema.items),
      // Read from the queue rather than from items: this is "did we check",
      // and a poll that found nothing still completed.
      db.execute(sql`
        select data->>'source' as source, max(completed_on) as last
        from pgboss.job
        where name = 'poll' and state = 'completed'
        group by 1
      `),
    ]);

    const pollRows = (
      Array.isArray(polls) ? polls : ((polls as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ source: string | null; last: string | Date | null }>;

    const seen = new Map<string, Date | null>();
    for (const row of pollRows) {
      if (row.source === null) continue;
      seen.set(row.source, row.last === null ? null : new Date(row.last));
    }

    return {
      postsRead24h: Number(recent[0]?.n ?? 0),
      postsReadTotal: Number(total[0]?.n ?? 0),
      // Fixed order, and every live source listed whether or not it has ever
      // returned anything — a source missing from the strip would read as an
      // outage rather than a quiet hour.
      sources: LIVE_SOURCES.map((source) => ({
        source,
        lastPolledAt: seen.get(source) ?? null,
      })),
    };
  } catch {
    return null;
  }
}
