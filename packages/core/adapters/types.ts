/**
 * The source-adapter seam (ARCHITECTURE.md section 4.1).
 *
 * One interface, many sources. Everything downstream of an adapter works on
 * `RawItem`, so adding or dropping a platform never touches the pipeline.
 *
 * Two invariants every adapter must honour:
 *   1. Validate the provider's payload with Zod at the boundary. A shape change
 *      upstream must fail loudly here, not surface as `undefined` in a digest.
 *   2. Never exceed the source's rate budget. Enforcement lives in the adapter,
 *      not in the caller, because the budget is per-source and shared across
 *      every customer.
 */
import { z } from "zod";

export const sourceName = z.enum([
  "reddit",
  "hn",
  "lobsters",
  "stackexchange",
  "bluesky",
  "rss",
  "x",
]);
export type SourceName = z.infer<typeof sourceName>;

/**
 * A post as it lands from a provider, normalised but not yet filtered,
 * classified or scored. `externalId` is the platform-native id and, paired with
 * `source`, is the dedup key backing `UNIQUE(source, external_id)`.
 */
export const rawItem = z.object({
  source: sourceName,
  externalId: z.string().min(1),
  url: z.url(),
  author: z.string().nullable(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  /** Sub-source the item came from: "r/SaaS", "news.ycombinator.com". */
  venue: z.string().nullable(),
  postedAt: z.date().nullable(),
  /** Upvotes, comment counts — whatever the source gives us, shape-free. */
  engagement: z.record(z.string(), z.unknown()).nullable(),
});
export type RawItem = z.infer<typeof rawItem>;

/**
 * Where the last poll got to, persisted per (watch, source) in `cursors`.
 *
 * Reddit paginates by fullname, so its cursor is one `t3_*` per subreddit.
 * HN's Algolia index is time-ordered, so its cursor is a unix second.
 * A null cursor means "first run" and adapters must cope with it.
 */
export const cursor = z.union([
  z.object({
    kind: z.literal("reddit"),
    /** subreddit (lowercased, no `r/`) -> newest fullname seen */
    newestBySubreddit: z.record(z.string(), z.string()),
  }),
  z.object({
    kind: z.literal("hn"),
    /** Algolia `created_at_i`, unix seconds. */
    newestCreatedAt: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("lobsters"),
    /** Epoch milliseconds: Lobsters returns ISO timestamps, not unix. */
    newestCreatedAt: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("stackexchange"),
    /** `creation_date`, unix seconds. */
    newestCreatedAt: z.number().int().nonnegative(),
  }),
]);
export type Cursor = z.infer<typeof cursor>;

/** The subset of a `watches` row an adapter needs. */
export interface WatchConfig {
  id: string;
  customerId: string;
  name: string;
  sources: SourceName[];
  subreddits: string[];
  includeTerms: string[];
  excludeTerms: string[];
  /**
   * Per-source settings keyed by source name, e.g.
   * `{ stackexchange: { sites: ["softwareengineering"] } }`. Avoids a column
   * per source as more of them land.
   */
  sourceConfig?: unknown;
}

/** What one fetch cost, for `api_usage`. */
export interface FetchCost {
  /** HTTP requests actually issued, including token refreshes. */
  calls: number;
}

export interface FetchResult {
  items: RawItem[];
  /** Null when there was nothing new and the cursor should stay put. */
  nextCursor: Cursor | null;
  cost: FetchCost;
  /**
   * Non-fatal problems the operator should see — a query too broad to cover in
   * one window, a source degrading. The poll job logs these; the digest job
   * will use them to flag a digest as degraded rather than going silent.
   */
  warnings?: string[];
}

export interface SourceAdapter {
  readonly source: SourceName;
  fetchNew(watch: WatchConfig, cursor: Cursor | null): Promise<FetchResult>;
}

/**
 * Parse a jsonb cursor read out of `cursors`. Anything unrecognised — a cursor
 * written by an older shape, or a hand-edited row — degrades to null, which
 * every adapter must already handle as "first run".
 */
export function parseCursor(value: unknown): Cursor | null {
  if (value === null || value === undefined) return null;
  const parsed = cursor.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Narrow a persisted jsonb cursor to the shape this adapter understands. */
export function cursorFor<K extends Cursor["kind"]>(
  kind: K,
  value: unknown,
): Extract<Cursor, { kind: K }> | null {
  if (value === null || value === undefined) return null;
  const parsed = cursor.safeParse(value);
  if (!parsed.success || parsed.data.kind !== kind) return null;
  return parsed.data as Extract<Cursor, { kind: K }>;
}
