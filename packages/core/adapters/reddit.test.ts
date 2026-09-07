import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdapterError, RateLimitedError } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import { createRedditAdapter, normaliseSubreddits } from "./reddit.ts";
import type { Cursor, WatchConfig } from "./types.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const credentials = {
  clientId: "test-id",
  clientSecret: "test-secret",
  userAgent: "intentowl-test/0.1",
};

/** A fresh bucket per adapter keeps tests independent of the shared one. */
function adapter() {
  return createRedditAdapter({
    credentials,
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 100 }),
  });
}

const watch: WatchConfig = {
  id: "watch-1",
  customerId: "customer-1",
  name: "test watch",
  sources: ["reddit"],
  subreddits: ["r/SaaS", "microsaas"],
  includeTerms: [],
  excludeTerms: [],
};

function tokenHandler() {
  return http.post("https://www.reddit.com/api/v1/access_token", () =>
    HttpResponse.json({
      access_token: "token-abc",
      token_type: "bearer",
      expires_in: 3600,
    }),
  );
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    kind: "t3",
    data: {
      name: "t3_aaa",
      id: "aaa",
      subreddit: "SaaS",
      title: "Looking for a tool to monitor Reddit",
      selftext: "We keep missing threads about our niche.",
      author: "founder_jane",
      permalink: "/r/SaaS/comments/aaa/looking_for_a_tool/",
      created_utc: 1_757_000_000,
      score: 12,
      num_comments: 4,
      upvote_ratio: 0.95,
      stickied: false,
      ...overrides,
    },
  };
}

function listing(children: unknown[]) {
  return { kind: "Listing", data: { children } };
}

describe("normaliseSubreddits", () => {
  it("strips prefixes, lowercases and dedupes", () => {
    expect(normaliseSubreddits(["r/SaaS", "/r/saas", "MicroSaaS", "  "])).toEqual([
      "saas",
      "microsaas",
    ]);
  });
});

describe("reddit adapter", () => {
  it("normalises posts and returns a fullname cursor per subreddit", async () => {
    server.use(
      tokenHandler(),
      http.get("https://oauth.reddit.com/r/saas/new", () =>
        HttpResponse.json(listing([post()])),
      ),
      http.get("https://oauth.reddit.com/r/microsaas/new", () =>
        HttpResponse.json(
          listing([post({ name: "t3_bbb", id: "bbb", subreddit: "microsaas" })]),
        ),
      ),
    );

    const result = await adapter().fetchNew(watch, null);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      source: "reddit",
      externalId: "t3_aaa",
      url: "https://www.reddit.com/r/SaaS/comments/aaa/looking_for_a_tool/",
      author: "founder_jane",
      venue: "r/SaaS",
    });
    expect(result.items[0]?.postedAt?.toISOString()).toBe(
      new Date(1_757_000_000 * 1000).toISOString(),
    );
    expect(result.nextCursor).toEqual({
      kind: "reddit",
      newestBySubreddit: { saas: "t3_aaa", microsaas: "t3_bbb" },
    });
    // one token request + two listings
    expect(result.cost.calls).toBe(3);
  });

  it("sends the stored fullname as `before` on the next poll", async () => {
    const seen: (string | null)[] = [];
    server.use(
      tokenHandler(),
      http.get("https://oauth.reddit.com/r/saas/new", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("before"));
        return HttpResponse.json(listing([]));
      }),
      http.get("https://oauth.reddit.com/r/microsaas/new", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("before"));
        return HttpResponse.json(listing([]));
      }),
    );

    const previous: Cursor = {
      kind: "reddit",
      newestBySubreddit: { saas: "t3_zzz", microsaas: "t3_yyy" },
    };
    const result = await adapter().fetchNew(watch, previous);

    expect(seen).toEqual(["t3_zzz", "t3_yyy"]);
    expect(result.items).toHaveLength(0);
    // An empty page must not reset the cursor.
    expect(result.nextCursor).toEqual(previous);
  });

  it("drops stickied posts and de-duplicates within one fetch", async () => {
    server.use(
      tokenHandler(),
      http.get("https://oauth.reddit.com/r/saas/new", () =>
        HttpResponse.json(
          listing([
            post({ stickied: true, name: "t3_pinned" }),
            post(),
            post(), // same fullname twice in one page
          ]),
        ),
      ),
      http.get("https://oauth.reddit.com/r/microsaas/new", () =>
        HttpResponse.json(listing([])),
      ),
    );

    const result = await adapter().fetchNew(watch, null);
    expect(result.items.map((i) => i.externalId)).toEqual(["t3_aaa"]);
  });

  it("issues one combined search when the watch has include terms", async () => {
    let query: string | null = null;
    server.use(
      tokenHandler(),
      http.get("https://oauth.reddit.com/r/saas/new", () =>
        HttpResponse.json(listing([])),
      ),
      http.get("https://oauth.reddit.com/r/microsaas/new", () =>
        HttpResponse.json(listing([])),
      ),
      // A RegExp matcher, not a string: `+` is Reddit's multi-subreddit
      // separator but a modifier in msw's path syntax.
      http.get(/\/r\/saas\+microsaas\/search/, ({ request }) => {
        query = new URL(request.url).searchParams.get("q");
        return HttpResponse.json(
          listing([post({ name: "t3_search", id: "search" })]),
        );
      }),
    );

    const result = await adapter().fetchNew(
      { ...watch, includeTerms: ["reddit monitoring", "lead gen"] },
      null,
    );

    expect(query).toBe('"reddit monitoring" OR "lead gen"');
    expect(result.items.map((i) => i.externalId)).toEqual(["t3_search"]);
  });

  it("raises RateLimitedError with the server's retry-after", async () => {
    server.use(
      tokenHandler(),
      http.get("https://oauth.reddit.com/r/saas/new", () =>
        HttpResponse.json({}, { status: 429, headers: { "retry-after": "42" } }),
      ),
    );

    await expect(adapter().fetchNew(watch, null)).rejects.toMatchObject({
      name: "RateLimitedError",
      retryAfterSeconds: 42,
    });
    await expect(adapter().fetchNew(watch, null)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("rejects a payload whose shape changed upstream", async () => {
    server.use(
      tokenHandler(),
      http.get("https://oauth.reddit.com/r/saas/new", () =>
        // `name` gone — our dedup key. Must fail loudly, not silently import.
        HttpResponse.json(listing([{ kind: "t3", data: { id: "aaa" } }])),
      ),
    );

    await expect(adapter().fetchNew(watch, null)).rejects.toBeInstanceOf(
      AdapterError,
    );
  });

  it("reuses the cached access token across polls", async () => {
    let tokenRequests = 0;
    server.use(
      http.post("https://www.reddit.com/api/v1/access_token", () => {
        tokenRequests += 1;
        return HttpResponse.json({
          access_token: "token-abc",
          token_type: "bearer",
          expires_in: 3600,
        });
      }),
      http.get("https://oauth.reddit.com/r/saas/new", () =>
        HttpResponse.json(listing([])),
      ),
      http.get("https://oauth.reddit.com/r/microsaas/new", () =>
        HttpResponse.json(listing([])),
      ),
    );

    const reddit = adapter();
    await reddit.fetchNew(watch, null);
    await reddit.fetchNew(watch, null);

    expect(tokenRequests).toBe(1);
  });
});
