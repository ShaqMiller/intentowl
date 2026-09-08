/**
 * Bluesky adapter (ARCHITECTURE.md section 4.1).
 *
 * ## Status: built, never run against the live API
 *
 * Two things blocked verification: no `BLUESKY_IDENTIFIER` /
 * `BLUESKY_APP_PASSWORD` were configured, and the unauthenticated AppView
 * (`public.api.bsky.app`) returned 403 to `app.bsky.feed.searchPosts` from the
 * build environment even with a user agent. So this is written against the
 * documented lexicon shapes and covered by fixture tests only — the same
 * position the Reddit adapter is in. Treat every field mapping below as
 * unconfirmed until a real poll succeeds, and do not offer Bluesky as a live
 * source to a customer before then.
 *
 * The design follows the other adapters: one request per include term, because
 * `searchPosts` takes a single query string and joining terms would either AND
 * them into nothing or OR them into noise.
 */
import { z } from "zod";

import { AdapterError, fetchJson, RateLimitedError } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import {
  cursorFor,
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

/** Terms searched per poll, matching the HN adapter's shape and budget. */
const MAX_TERMS_PER_POLL = 10;

/** Pages walked per term before accepting a gap and warning. */
const MAX_PAGES_PER_TERM = 2;

/** First run has no cursor; a week back, as elsewhere. */
const COLD_START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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
      let newest = since;
      let calls = 0;

      let token = accessJwt ?? (await authenticate());
      calls += accessJwt === null ? 1 : 0;

      for (const term of watch.includeTerms.slice(0, MAX_TERMS_PER_POLL)) {
        let pageCursor: string | undefined;

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
            // An expired token looks like a 401. Re-mint once and retry the
            // page; anything else is the caller's problem.
            if (isUnauthorized(error) && accessJwt !== null) {
              accessJwt = null;
              token = await authenticate();
              calls += 1;
              page -= 1;
              continue;
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

function isUnauthorized(error: unknown): boolean {
  if (error instanceof RateLimitedError) return false;
  return error instanceof AdapterError && /\b401\b/.test(error.message);
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
