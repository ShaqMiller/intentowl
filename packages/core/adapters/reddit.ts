/**
 * Reddit adapter — the primary source (ARCHITECTURE.md section 4.1).
 *
 * OAuth2 client-credentials against a "script" app. Two hard rules are baked in
 * here rather than left to callers:
 *
 *   - every request draws from the shared `redditBucket`, because Reddit meters
 *     our whole OAuth client, not one customer;
 *   - a 429 raises `RateLimitedError` so the poll job reschedules itself
 *     instead of hammering.
 *
 * The cursor is one newest-seen fullname (`t3_*`) per subreddit, which is how
 * Reddit's own `before=` pagination works, so re-polling costs one request per
 * subreddit no matter how long the worker was down.
 */
import { z } from "zod";

import { AdapterError, fetchJson } from "./http.ts";
import { redditBucket } from "./rate-limit.ts";
import {
  cursorFor,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "reddit" as const;
const OAUTH_URL = "https://www.reddit.com/api/v1/access_token";
const API_ORIGIN = "https://oauth.reddit.com";

/** Reddit caps `limit` at 100. One page per subreddit per poll is plenty. */
const PAGE_LIMIT = 100;

/** Guard against a runaway watch: never issue more than this per poll. */
const MAX_REQUESTS_PER_POLL = 24;

// --- provider payloads ------------------------------------------------------

const tokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
});

const listingChild = z.object({
  kind: z.string(),
  data: z.object({
    // Reddit omits `name` on some kinds; we require it because it is our id.
    name: z.string().min(1),
    id: z.string().min(1),
    subreddit: z.string().nullish(),
    title: z.string().nullish(),
    selftext: z.string().nullish(),
    author: z.string().nullish(),
    permalink: z.string().nullish(),
    url: z.string().nullish(),
    created_utc: z.number().nullish(),
    score: z.number().nullish(),
    num_comments: z.number().nullish(),
    upvote_ratio: z.number().nullish(),
    over_18: z.boolean().nullish(),
    stickied: z.boolean().nullish(),
  }),
});

const listingResponse = z.object({
  kind: z.literal("Listing"),
  data: z.object({
    children: z.array(listingChild),
  }),
});

export interface RedditCredentials {
  clientId: string;
  clientSecret: string;
  userAgent: string;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export interface RedditAdapterOptions {
  credentials: RedditCredentials;
  /** Injected in tests; defaults to the shared process-wide bucket. */
  bucket?: typeof redditBucket;
}

export function createRedditAdapter(
  options: RedditAdapterOptions,
): SourceAdapter {
  const { credentials } = options;
  const bucket = options.bucket ?? redditBucket;

  // Token is cached across polls — refreshing per request would waste a third
  // of the rate budget on auth.
  let cached: CachedToken | null = null;
  let inFlight: Promise<string> | null = null;

  async function accessToken(counter: Counter): Promise<string> {
    if (cached !== null && cached.expiresAt > Date.now() + 60_000) {
      return cached.value;
    }
    // Collapse concurrent refreshes into one request.
    inFlight ??= (async () => {
      await bucket.take();
      counter.calls += 1;
      const basic = Buffer.from(
        `${credentials.clientId}:${credentials.clientSecret}`,
      ).toString("base64");
      const token = await fetchJson(
        {
          source: SOURCE,
          url: OAUTH_URL,
          method: "POST",
          headers: {
            authorization: `Basic ${basic}`,
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": credentials.userAgent,
          },
          body: "grant_type=client_credentials",
        },
        tokenResponse,
      );
      cached = {
        value: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      };
      return token.access_token;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function getListing(
    path: string,
    params: Record<string, string>,
    counter: Counter,
  ): Promise<z.infer<typeof listingResponse>> {
    const token = await accessToken(counter);
    await bucket.take();
    counter.calls += 1;
    const url = `${API_ORIGIN}${path}?${new URLSearchParams(params).toString()}`;
    return fetchJson(
      {
        source: SOURCE,
        url,
        headers: {
          authorization: `Bearer ${token}`,
          "user-agent": credentials.userAgent,
        },
      },
      listingResponse,
    );
  }

  return {
    source: SOURCE,

    async fetchNew(
      watch: WatchConfig,
      previous: Cursor | null,
    ): Promise<FetchResult> {
      const counter: Counter = { calls: 0 };
      const previousCursor = cursorFor("reddit", previous);
      const newestBySubreddit: Record<string, string> = {
        ...(previousCursor?.newestBySubreddit ?? {}),
      };

      const subreddits = normaliseSubreddits(watch.subreddits);
      if (subreddits.length === 0 && watch.includeTerms.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has neither subreddits nor include terms`,
        );
      }

      const items: RawItem[] = [];
      const seen = new Set<string>();
      let budget = MAX_REQUESTS_PER_POLL;

      // Pass 1: /r/{sub}/new for each watched subreddit.
      for (const subreddit of subreddits) {
        if (budget <= 0) break;
        budget -= 1;

        const before = newestBySubreddit[subreddit];
        const listing = await getListing(
          `/r/${subreddit}/new`,
          {
            limit: String(PAGE_LIMIT),
            ...(before === undefined ? {} : { before }),
          },
          counter,
        );

        const posts = listing.data.children.filter(
          (child) => child.kind === "t3",
        );
        // Reddit returns newest first, so the head is the next cursor. Only
        // advance it when something came back; an empty page must not reset it.
        const newest = posts[0]?.data.name;
        if (newest !== undefined) newestBySubreddit[subreddit] = newest;

        for (const post of posts) {
          const item = toRawItem(post.data);
          if (item === null || seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          items.push(item);
        }
      }

      // Pass 2: one keyword search across the watched subreddits. Catches posts
      // in subreddits the customer did not list. One request, not one per term.
      if (budget > 0 && watch.includeTerms.length > 0) {
        budget -= 1;
        const query = watch.includeTerms
          .map((term) => (term.includes(" ") ? `"${term}"` : term))
          .join(" OR ");
        const path =
          subreddits.length > 0
            ? `/r/${subreddits.join("+")}/search`
            : "/search";
        const listing = await getListing(
          path,
          {
            q: query,
            sort: "new",
            limit: String(PAGE_LIMIT),
            t: "week",
            ...(subreddits.length > 0 ? { restrict_sr: "true" } : {}),
          },
          counter,
        );

        for (const child of listing.data.children) {
          if (child.kind !== "t3") continue;
          const item = toRawItem(child.data);
          if (item === null || seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          items.push(item);
        }
      }

      const nextCursor: Cursor = { kind: "reddit", newestBySubreddit };
      return { items, nextCursor, cost: { calls: counter.calls } };
    },
  };
}

interface Counter {
  calls: number;
}

/** Accept "r/SaaS", "/r/SaaS" or "saas" and produce "saas". */
export function normaliseSubreddits(input: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const name = raw
      .trim()
      .replace(/^\/?r\//i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

type PostData = z.infer<typeof listingChild>["data"];

function toRawItem(data: PostData): RawItem | null {
  // Stickied mod posts are announcements, never leads.
  if (data.stickied === true) return null;

  const permalink = data.permalink ?? null;
  const url =
    permalink === null ? (data.url ?? null) : `https://www.reddit.com${permalink}`;
  if (url === null) return null;

  const author = data.author ?? null;
  return {
    source: SOURCE,
    externalId: data.name,
    url,
    // Reddit tombstones removed authors as "[deleted]".
    author: author === "[deleted]" ? null : author,
    title: data.title ?? null,
    body: data.selftext === "" ? null : (data.selftext ?? null),
    venue: data.subreddit == null ? null : `r/${data.subreddit}`,
    postedAt:
      data.created_utc == null ? null : new Date(data.created_utc * 1000),
    engagement: {
      score: data.score ?? null,
      comments: data.num_comments ?? null,
      upvoteRatio: data.upvote_ratio ?? null,
    },
  };
}
