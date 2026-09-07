/**
 * Stack Exchange adapter.
 *
 * The best source of pure pain-points anywhere: people describe a problem in
 * detail, in public, with no incentive to posture. "How do I do X" is exactly
 * the shape a pain_point lead takes.
 *
 * The binding constraint is quota, not rate. Unauthenticated calls get **300
 * per day per IP**, shared across every customer — a budget small enough that
 * an unbounded poll loop would exhaust it before lunch. A free registered key
 * raises it to 10,000/day and is strongly recommended before this source is
 * pointed at more than one customer.
 *
 * Two provider behaviours this adapter must respect:
 *   - `quota_remaining` on every response, which we surface and refuse to burn
 *     past a reserve.
 *   - an occasional `backoff` field, which is a hard instruction to wait that
 *     many seconds before the next call to the same method.
 */
import { z } from "zod";

import {
  AdapterError,
  fetchJson,
  RateLimitedError,
  SchemaError,
} from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import {
  cursorFor,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "stackexchange" as const;
const API = "https://api.stackexchange.com/2.3/search/advanced";

/**
 * Sites to search when a watch does not name any. Chosen for a
 * developer-tooling ICP: where founders and engineers describe process and
 * workflow problems rather than pure coding questions.
 */
const DEFAULT_SITES = ["softwareengineering", "stackoverflow"] as const;

/** Hard ceiling per poll. Quota is 300/day unauthenticated and shared. */
const MAX_REQUESTS_PER_POLL = 6;

/** Stop calling entirely below this, so one watch cannot starve the rest. */
const QUOTA_RESERVE = 20;

const PAGE_SIZE = 50;

/** First run has no cursor; a week back at this volume is plenty. */
const COLD_START_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

const question = z.object({
  question_id: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  link: z.string(),
  creation_date: z.number(),
  score: z.number().nullish(),
  answer_count: z.number().nullish(),
  view_count: z.number().nullish(),
  is_answered: z.boolean().nullish(),
  tags: z.array(z.string()).nullish(),
  owner: z.object({ display_name: z.string().nullish() }).nullish(),
});

const searchResponse = z.object({
  items: z.array(question),
  has_more: z.boolean().nullish(),
  quota_max: z.number().nullish(),
  quota_remaining: z.number().nullish(),
  /** Present when the API demands a pause before the next call. */
  backoff: z.number().nullish(),
});

/** Generous: quota is the real limit, not requests per second. */
export const stackExchangeBucket = new TokenBucket({
  capacity: 10,
  refillPerSecond: 1,
});

export interface StackExchangeAdapterOptions {
  bucket?: TokenBucket;
  /** Free key from stackapps.com. Raises the daily quota from 300 to 10,000. */
  apiKey?: string;
}

export function createStackExchangeAdapter(
  options: StackExchangeAdapterOptions = {},
): SourceAdapter {
  const bucket = options.bucket ?? stackExchangeBucket;

  return {
    source: SOURCE,

    async fetchNew(
      watch: WatchConfig,
      previous: Cursor | null,
    ): Promise<FetchResult> {
      if (watch.includeTerms.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has no include terms; Stack Exchange search needs a query`,
        );
      }

      const sites = resolveSites(watch);
      const previousCursor = cursorFor("stackexchange", previous);
      const since =
        previousCursor?.newestCreatedAt ??
        Math.floor(Date.now() / 1000) - COLD_START_LOOKBACK_SECONDS;

      const items: RawItem[] = [];
      const seen = new Set<string>();
      const warnings: string[] = [];
      let newest = since;
      let calls = 0;
      let quotaRemaining: number | null = null;

      // Budget the requests across sites so one site cannot consume the poll.
      const perSite = Math.max(1, Math.floor(MAX_REQUESTS_PER_POLL / sites.length));

      outer: for (const site of sites) {
        for (const term of watch.includeTerms.slice(0, perSite)) {
          if (calls >= MAX_REQUESTS_PER_POLL) break outer;
          if (quotaRemaining !== null && quotaRemaining <= QUOTA_RESERVE) {
            warnings.push(
              `Stack Exchange quota down to ${quotaRemaining}; stopping early. Register a free key at stackapps.com to raise it from 300/day to 10,000.`,
            );
            break outer;
          }

          await bucket.take();
          calls += 1;

          const params = new URLSearchParams({
            order: "desc",
            sort: "creation",
            q: term,
            site,
            filter: "withbody",
            pagesize: String(PAGE_SIZE),
            fromdate: String(since),
          });
          if (options.apiKey !== undefined) params.set("key", options.apiKey);

          let response;
          try {
            response = await fetchJson(
              {
                source: SOURCE,
                url: `${API}?${params.toString()}`,
                headers: { "user-agent": "intentowl/0.1" },
              },
              searchResponse,
            );
          } catch (error) {
            // A mistyped site name returns 400 ("No site found for name X").
            // Killing the whole poll for one bad config value would take the
            // other sites down with it; skip and say which one is wrong.
            // A shape change means the contract broke and must surface; only
            // a request the provider rejected is safe to skip.
            if (
              error instanceof AdapterError &&
              !(error instanceof RateLimitedError) &&
              !(error instanceof SchemaError)
            ) {
              warnings.push(
                `Stack Exchange site "${site}" rejected the request and was skipped: ${error.message}`,
              );
              continue;
            }
            throw error;
          }

          quotaRemaining = response.quota_remaining ?? quotaRemaining;

          for (const entry of response.items) {
            const id = String(entry.question_id);
            if (seen.has(id)) continue;
            seen.add(id);
            if (entry.creation_date > newest) newest = entry.creation_date;
            items.push(toRawItem(entry, site));
          }

          // `backoff` is an instruction, not a suggestion: ignoring it is how
          // an app gets its key throttled. Surface it as a reschedule rather
          // than sleeping through the rest of the poll.
          if (response.backoff != null && response.backoff > 0) {
            throw new RateLimitedError(SOURCE, response.backoff);
          }
        }
      }

      if (quotaRemaining !== null && quotaRemaining < 100) {
        warnings.push(
          `Stack Exchange quota at ${quotaRemaining} for today across all customers.`,
        );
      }

      const nextCursor: Cursor = {
        kind: "stackexchange",
        newestCreatedAt: newest,
      };
      return {
        items,
        nextCursor,
        cost: { calls },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  };
}

/** Sites from the watch's sourceConfig, or a sensible default. */
export function resolveSites(watch: WatchConfig): string[] {
  const configured = (watch.sourceConfig as
    | { stackexchange?: { sites?: unknown } }
    | undefined)?.stackexchange?.sites;

  if (Array.isArray(configured)) {
    const sites = configured.filter(
      (s): s is string => typeof s === "string" && s.trim() !== "",
    );
    // Two sites at 300 requests/day shared is already tight; more is a trap.
    if (sites.length > 0) return sites.slice(0, 3);
  }
  return [...DEFAULT_SITES];
}

type Question = z.infer<typeof question>;

function toRawItem(entry: Question, site: string): RawItem {
  const body = stripHtml(entry.body ?? "");
  return {
    source: SOURCE,
    externalId: String(entry.question_id),
    url: entry.link,
    author: entry.owner?.display_name ?? null,
    title: decodeEntities(entry.title),
    body: body === "" ? null : body,
    // Read off the item's own link rather than composed from the site key.
    // The network's older sites do not carry the suffix — Stack Overflow is
    // stackoverflow.com, not stackoverflow.stackexchange.com — and venue
    // weighting keys on this string, so a wrong one is silently unweightable.
    venue: hostnameOf(entry.link) ?? `${site}.stackexchange.com`,
    postedAt: new Date(entry.creation_date * 1000),
    engagement: {
      score: entry.score ?? null,
      comments: entry.answer_count ?? null,
      views: entry.view_count ?? null,
      answered: entry.is_answered ?? null,
      tags: entry.tags ?? [],
    },
  };
}

/** Bodies come back as HTML even with `filter=withbody`. */
function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function hostnameOf(link: string): string | null {
  try {
    return new URL(link).hostname;
  } catch {
    return null;
  }
}
