/**
 * Threads adapter (Meta's official keyword search).
 *
 * ## Not yet verified against the live API
 *
 * Built from Meta's keyword-search reference, read on 2026-09-14:
 * `GET graph.threads.net/v1.0/keyword_search` with `q`, `search_type`
 * (TOP | RECENT), `since`/`until` in unix seconds, and `limit` up to 100.
 * Unlike Bluesky, nothing here has met a real response yet, because public
 * search needs Meta to approve the `threads_keyword_search` permission. Treat
 * the response schema as the documented contract, not an observed one, and
 * re-check it against the first real poll.
 *
 * ## The failure that looks like success
 *
 * Before that permission is approved, the same endpoint does not error — it
 * searches only the token owner's own posts. An unapproved token therefore
 * looks like a healthy source that never finds anything. Nothing in the
 * response distinguishes the two, which is why the setup doc says to test by
 * posting a thread that contains a search term and checking it arrives.
 *
 * ## Budget
 *
 * 2,200 searches per rolling 24 hours per Threads *user*, across every app.
 * Every customer's search runs on one token, so that is the whole
 * deployment's budget, not a per-customer one. The bucket never blocks: a
 * poll that runs out stops and says so, rather than sleeping for minutes
 * past the job's expiry.
 *
 * One page per term, newest first, from the cursor forward. Meta's `after`
 * cursor has been reported to repeat results, so a full page is a warning to
 * narrow the term rather than a pagination loop.
 */
import { z } from "zod";

import {
  AdapterError,
  fetchJson,
  RateLimitedError,
  SchemaError,
  TransientError,
} from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import {
  cursorFor,
  skippedTermsWarning,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "threads" as const;
const SEARCH = "https://graph.threads.net/v1.0/keyword_search";
const FIELDS =
  "id,text,media_type,permalink,timestamp,username,has_replies,is_quote_post,is_reply";

/** The documented maximum for `limit`. */
const PAGE_SIZE = 100;

/** Same cap as HN and Bluesky, so one watch behaves the same everywhere. */
const MAX_TERMS_PER_POLL = 30;

/** First run has no cursor; a week back, as elsewhere. */
const COLD_START_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

/** The earliest `since` the API accepts (5 July 2023, the launch of Threads). */
const EARLIEST_SINCE = 1_688_540_400;

/**
 * 2,000 of the 2,200 daily searches, leaving room for manual testing on the
 * same account. Upstream does not count searches that return nothing; this
 * does, which only ever errs towards stopping early.
 */
export const threadsBucket = new TokenBucket({
  capacity: 150,
  refillPerSecond: 2000 / 86_400,
});

const media = z.object({
  id: z.string().min(1),
  text: z.string().nullish(),
  media_type: z.string().nullish(),
  permalink: z.string().nullish(),
  timestamp: z.string().nullish(),
  username: z.string().nullish(),
  has_replies: z.boolean().nullish(),
  is_quote_post: z.boolean().nullish(),
  is_reply: z.boolean().nullish(),
});

const searchResponse = z.object({
  data: z.array(media),
});

export interface ThreadsAdapterOptions {
  /**
   * Called once per poll rather than captured at construction, so a token the
   * worker refreshed in the background is picked up without a restart.
   */
  getAccessToken: () => Promise<string>;
  bucket?: TokenBucket;
}

export function createThreadsAdapter(options: ThreadsAdapterOptions): SourceAdapter {
  const bucket = options.bucket ?? threadsBucket;

  return {
    source: SOURCE,

    async fetchNew(watch: WatchConfig, previous: Cursor | null): Promise<FetchResult> {
      if (watch.includeTerms.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has no include terms; Threads search needs a query`,
        );
      }

      const previousCursor = cursorFor("threads", previous);
      const since = Math.max(
        EARLIEST_SINCE,
        previousCursor?.newestTimestamp ??
          Math.floor(Date.now() / 1000) - COLD_START_LOOKBACK_SECONDS,
      );

      const token = await options.getAccessToken();
      const terms = watch.includeTerms.slice(0, MAX_TERMS_PER_POLL);

      const items: RawItem[] = [];
      const seen = new Set<string>();
      const warnings: string[] = [];
      let newest = since;
      let calls = 0;
      let attempted = 0;
      let rejected = 0;

      if (watch.includeTerms.length > terms.length) {
        warnings.push(skippedTermsWarning(watch.includeTerms.slice(terms.length)));
      }

      for (const term of terms) {
        if (!bucket.tryTake()) {
          warnings.push(
            `daily Threads search budget reached; ${terms.length - attempted} of ` +
              `${terms.length} terms were not searched this poll`,
          );
          break;
        }
        attempted += 1;
        calls += 1;

        const params = new URLSearchParams({
          q: term,
          search_type: "RECENT",
          fields: FIELDS,
          limit: String(PAGE_SIZE),
          since: String(since),
          access_token: token,
        });

        let response: z.infer<typeof searchResponse>;
        try {
          response = await fetchJson(
            { source: SOURCE, url: `${SEARCH}?${params.toString()}` },
            searchResponse,
          );
        } catch (error) {
          // One rejected term is about that query; keep the others, as the
          // Bluesky adapter learned to. Schema changes, rate limits and
          // transient failures still propagate — those are about the source.
          if (
            error instanceof AdapterError &&
            !(error instanceof SchemaError) &&
            !(error instanceof RateLimitedError) &&
            !(error instanceof TransientError)
          ) {
            rejected += 1;
            warnings.push(`term "${term}" was rejected (${error.message})`);
            continue;
          }
          throw error;
        }

        for (const entry of response.data) {
          const item = toRawItem(entry);
          if (item === null || seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          items.push(item);

          const at = item.postedAt === null ? null : Math.floor(item.postedAt.getTime() / 1000);
          if (at !== null && at > newest) newest = at;
        }

        if (response.data.length >= PAGE_SIZE) {
          warnings.push(
            `term "${term}" returned a full page of ${PAGE_SIZE}; older matches since the ` +
              `last poll may not have been read — a narrower term would cover it`,
          );
        }
      }

      // Meta reports an expired, revoked or under-permissioned token as a 400
      // on every request. Per-term tolerance would turn that into a poll that
      // "succeeds" with nothing but warnings, forever. When every search was
      // refused, the problem is the token, and the job should fail loudly.
      if (attempted > 0 && rejected === attempted) {
        throw new AdapterError(
          SOURCE,
          `every Threads search this poll was rejected (${rejected} of ${attempted}); ` +
            "the access token is probably expired, revoked, or missing threads_keyword_search",
        );
      }

      return {
        items,
        nextCursor: newest > since ? { kind: SOURCE, newestTimestamp: newest } : null,
        cost: { calls },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  };
}

export function toRawItem(entry: z.infer<typeof media>): RawItem | null {
  const text = entry.text ?? null;
  if (text === null || text.trim() === "") return null;

  // The permalink is the only address a customer can open; without it there
  // is no lead to act on.
  const url = entry.permalink ?? null;
  if (url === null || !/^https:\/\//.test(url)) return null;

  return {
    source: SOURCE,
    externalId: entry.id,
    url,
    author: entry.username ?? null,
    // Posts have no title, as on Bluesky; the headline falls back to the text.
    title: null,
    body: text,
    venue: "threads.net",
    postedAt: parseThreadsTimestamp(entry.timestamp),
    engagement: {
      hasReplies: entry.has_replies ?? false,
      isReply: entry.is_reply ?? false,
      isQuote: entry.is_quote_post ?? false,
    },
  };
}

/**
 * Meta writes offsets without a colon — `2023-10-17T05:42:03+0000` — which is
 * not ISO 8601 and not something every Date parser accepts. Normalise first.
 */
export function parseThreadsTimestamp(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const iso = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms);
}
