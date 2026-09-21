/**
 * Bluesky adapter (ARCHITECTURE.md section 4.1).
 *
 * ## Verified against the live API on 2026-09-09
 *
 * An authenticated poll returned 198 posts over two pages. Confirmed against a
 * real response rather than the lexicon alone: `sort=latest` really is
 * descending by `indexedAt`, the AT-URI is present on every post, the four
 * engagement counters come back as numbers, and the handle-based permalink
 * resolves. The 401 retry path is real too — `fetchJson` throws a message
 * carrying the status code, which is what `isUnauthorized` matches on.
 *
 * Note that `public.api.bsky.app` (the unauthenticated AppView) returns 403 to
 * `searchPosts` from some networks. This adapter does not use it; it
 * authenticates against bsky.social with an app password, which works.
 *
 * The design follows the other adapters: one request per include term, because
 * `searchPosts` takes a single query string and joining terms would either AND
 * them into nothing or OR them into noise.
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

const SOURCE = "bluesky" as const;
const HOST = "https://bsky.social";
const SEARCH = `${HOST}/xrpc/app.bsky.feed.searchPosts`;
const CREATE_SESSION = `${HOST}/xrpc/com.atproto.server.createSession`;

/** Posts per search page. The lexicon caps `limit` at 100. */
const PAGE_SIZE = 100;

/**
 * Terms searched per poll, matching the HN adapter. Was 10, which never
 * searched a longer watch's later terms at all.
 */
const MAX_TERMS_PER_POLL = 30;

/** Pages walked per term before accepting a gap and warning. */
const MAX_PAGES_PER_TERM = 2;

/** First run has no cursor; a week back, as elsewhere. */
const COLD_START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Re-mint the session before Bluesky expires it. Access tokens live about two
 * hours, and an expired one comes back as HTTP 400 `ExpiredToken` rather than
 * 401 — so waiting for the failure depends on recognising an error code in a
 * body. Renewing at 90 minutes means the normal path never meets it.
 */
const SESSION_MAX_AGE_MS = 90 * 60 * 1000;

/**
 * Bluesky publishes no hard public rate limit for reads, but the documented
 * write budget is 3000/hour per account. One request/second is well inside
 * anything plausible and keeps a poll polite.
 */
const blueskyBucket = new TokenBucket({ capacity: 5, refillPerSecond: 1 });

const session = z.object({
  accessJwt: z.string().min(1),
  did: z.string().min(1),
  handle: z.string().nullish(),
});

const author = z.object({
  did: z.string(),
  handle: z.string(),
  displayName: z.string().nullish(),
});

const record = z.object({
  text: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const post = z.object({
  uri: z.string().min(1),
  cid: z.string().nullish(),
  author,
  record,
  indexedAt: z.string().nullish(),
  likeCount: z.number().nullish(),
  replyCount: z.number().nullish(),
  repostCount: z.number().nullish(),
  quoteCount: z.number().nullish(),
});

const searchResponse = z.object({
  posts: z.array(post),
  cursor: z.string().nullish(),
});

export interface BlueskyCredentials {
  identifier: string;
  appPassword: string;
}

export interface BlueskyAdapterOptions {
  credentials: BlueskyCredentials;
  bucket?: TokenBucket;
}

export function createBlueskyAdapter(
  options: BlueskyAdapterOptions,
): SourceAdapter {
  const bucket = options.bucket ?? blueskyBucket;

  /**
   * Access tokens are short-lived. Cached across polls and re-minted on 401
   * rather than refreshed, because a fresh session is one request and the
   * refresh dance is two code paths to get wrong.
   */
  let accessJwt: string | null = null;
  let mintedAt = 0;

  async function authenticate(): Promise<string> {
    await bucket.take();
    const result = await fetchJson(
      {
        source: SOURCE,
        url: CREATE_SESSION,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identifier: options.credentials.identifier,
          password: options.credentials.appPassword,
        }),
      },
      session,
    );
    accessJwt = result.accessJwt;
    mintedAt = Date.now();
    return result.accessJwt;
  }

  return {
    source: SOURCE,

    async fetchNew(
      watch: WatchConfig,
      previous: Cursor | null,
    ): Promise<FetchResult> {
      if (watch.includeTerms.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has no include terms; Bluesky search needs a query`,
        );
      }

      const previousCursor = cursorFor("bluesky", previous);
      const since =
        previousCursor?.newestIndexedAt ?? Date.now() - COLD_START_LOOKBACK_MS;

      const items: RawItem[] = [];
      const seen = new Set<string>();
      const warnings: string[] = [];
      if (watch.includeTerms.length > MAX_TERMS_PER_POLL) {
        warnings.push(skippedTermsWarning(watch.includeTerms.slice(MAX_TERMS_PER_POLL)));
      }
      let newest = since;
      let calls = 0;
      // Bounds the 401 branch below to one re-mint per poll. It claimed to
      // "re-mint once" but had no guard: credentials that are simply wrong
      // return 401 on every attempt, so the loop re-authenticated against
      // Bluesky forever. Per poll rather than global, because a later poll may
      // legitimately need a fresh token after this one's expires.
      let reauthenticated = false;

      let token: string;
      if (accessJwt !== null && Date.now() - mintedAt < SESSION_MAX_AGE_MS) {
        token = accessJwt;
      } else {
        token = await authenticate();
        calls += 1;
      }

      let searched = 0;
      let rejectedOutright = 0;
      let lastRejection = "";

      for (const term of watch.includeTerms.slice(0, MAX_TERMS_PER_POLL)) {
        let pageCursor: string | undefined;
        searched += 1;

        for (let page = 0; page < MAX_PAGES_PER_TERM; page += 1) {
          await bucket.take();
          calls += 1;

          const params = new URLSearchParams({
            q: term,
            limit: String(PAGE_SIZE),
            // Newest first, so the cursor comparison can stop early.
            sort: "latest",
          });
          if (pageCursor !== undefined) params.set("cursor", pageCursor);

          let response: z.infer<typeof searchResponse>;
          try {
            response = await fetchJson(
              {
                source: SOURCE,
                url: `${SEARCH}?${params.toString()}`,
                headers: { authorization: `Bearer ${token}` },
              },
              searchResponse,
            );
          } catch (error) {
            // An expired or invalid session (400 ExpiredToken, or a 401). Re-mint
            // once per poll and retry the page; if the fresh session is refused
            // too, it falls through and fails the job.
            if (isUnauthorized(error) && accessJwt !== null && !reauthenticated) {
              reauthenticated = true;
              accessJwt = null;
              token = await authenticate();
              calls += 1;
              page -= 1;
              continue;
            }

            // A plain rejection is about this request, not the source: keep
            // what this term already found, say so, move on. Only plain
            // rejections, though, and never all of them — see the check after
            // the loop.
            //
            // History worth keeping: the 92 failed polls on 12-13 September
            // were blamed on "one bad page" and fixed with this tolerance. They
            // were expired sessions reported as 400. The tolerance turned a
            // loud failure into a silent one, and the source returned nothing
            // from 15 to 21 September while every poll "succeeded".
            //
            // Everything else still propagates on purpose. A SchemaError means
            // the payload contract changed and must fail loudly; a rate limit
            // has to reach the job so it reschedules; a transient failure is
            // what pg-boss retries are for; and a 401 that survives a fresh
            // session means the credentials are wrong, which nobody should
            // find out about from a warning.
            if (
              error instanceof AdapterError &&
              !(error instanceof SchemaError) &&
              !(error instanceof RateLimitedError) &&
              !(error instanceof TransientError) &&
              !isUnauthorized(error)
            ) {
              warnings.push(
                `term "${term}" page ${page + 1} was rejected (${error.message}); ` +
                  `kept ${page === 0 ? "nothing" : "the earlier pages"} for this term`,
              );
              if (page === 0) rejectedOutright += 1;
              lastRejection = error.message;
              break;
            }
            throw error;
          }

          let reachedCursor = false;
          for (const entry of response.posts) {
            const indexed = Date.parse(
              entry.indexedAt ?? entry.record.createdAt ?? "",
            );
            if (Number.isNaN(indexed)) continue;
            if (indexed <= since) {
              // Sorted newest-first, so everything after this is older too.
              reachedCursor = true;
              break;
            }

            const item = toRawItem(entry);
            if (item === null || seen.has(item.externalId)) continue;
            seen.add(item.externalId);
            items.push(item);
            if (indexed > newest) newest = indexed;
          }

          if (reachedCursor) break;
          if (response.cursor === null || response.cursor === undefined) break;
          if (response.posts.length < PAGE_SIZE) break;
          pageCursor = response.cursor;

          if (page === MAX_PAGES_PER_TERM - 1) {
            warnings.push(
              `term "${term}" still had results after ${MAX_PAGES_PER_TERM} pages; some posts were not read`,
            );
          }
        }
      }

      // One rejected term is a bad query. Every term rejected is the source,
      // the session or the account — and must fail the job, not return an
      // empty poll that looks exactly like a quiet day.
      if (searched > 0 && rejectedOutright === searched) {
        throw new AdapterError(
          SOURCE,
          `every Bluesky search this poll was rejected (${rejectedOutright} of ${searched}); ` +
            `last: ${lastRejection}`,
        );
      }

      return {
        items,
        nextCursor:
          newest > since ? { kind: SOURCE, newestIndexedAt: newest } : null,
        cost: { calls },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  };
}

/**
 * A session Bluesky will not accept. Not only 401: the AppView reports an
 * expired or malformed access token as 400 with `ExpiredToken` or
 * `InvalidToken` in the body, which `fetchJson` now carries in the message.
 */
function isUnauthorized(error: unknown): boolean {
  if (error instanceof RateLimitedError) return false;
  return (
    error instanceof AdapterError &&
    /\b401\b|ExpiredToken|InvalidToken|AuthRequired|AuthMissing/.test(error.message)
  );
}

/**
 * `at://did:plc:abc/app.bsky.feed.post/3kxyz` is the canonical id; the
 * human-readable permalink is built from the handle and the record key.
 */
export function toRawItem(entry: z.infer<typeof post>): RawItem | null {
  const rkey = entry.uri.split("/").pop();
  if (rkey === undefined || rkey === "") return null;

  const text = entry.record.text ?? null;
  if (text === null || text.trim() === "") return null;

  const posted = Date.parse(entry.record.createdAt ?? entry.indexedAt ?? "");

  return {
    source: SOURCE,
    // The AT-URI, not the permalink: handles change, DIDs do not, and this is
    // the dedup key behind UNIQUE(source, external_id).
    externalId: entry.uri,
    url: `https://bsky.app/profile/${entry.author.handle}/post/${rkey}`,
    author: entry.author.handle,
    // Posts have no title. Leaving it null rather than duplicating the text
    // keeps the classifier from reading the same words twice.
    title: null,
    body: text,
    venue: "bsky.app",
    postedAt: Number.isNaN(posted) ? null : new Date(posted),
    engagement: {
      likes: entry.likeCount ?? 0,
      replies: entry.replyCount ?? 0,
      reposts: entry.repostCount ?? 0,
      quotes: entry.quoteCount ?? 0,
    },
  };
}
