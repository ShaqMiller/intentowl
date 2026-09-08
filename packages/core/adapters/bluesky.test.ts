/**
 * Bluesky adapter tests — fixtures only.
 *
 * These prove the adapter does what the code says it does. They cannot prove
 * the fixtures match what Bluesky actually returns, because the adapter has
 * never reached the live API (403 from the public AppView, and no credentials
 * configured). The mappings below are read from the published lexicon and
 * should be re-checked against a real response before Bluesky is offered as a
 * source to anyone.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createBlueskyAdapter } from "./bluesky.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { WatchConfig } from "./types.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** No waiting in tests; the real bucket is exercised in rate-limit.test.ts. */
function fastBucket(): TokenBucket {
  return new TokenBucket({ capacity: 1000, refillPerSecond: 1000 });
}

function adapter() {
  return createBlueskyAdapter({
    credentials: { identifier: "me.bsky.social", appPassword: "app-pass" },
    bucket: fastBucket(),
  });
}

function watch(overrides: Partial<WatchConfig> = {}): WatchConfig {
  return {
    id: "w1",
    customerId: "c1",
    name: "test",
    sources: ["bluesky"],
    subreddits: [],
    includeTerms: ["invoicing tool"],
    excludeTerms: [],
    ...overrides,
  };
}

function postFixture(overrides: Record<string, unknown> = {}) {
  return {
    uri: "at://did:plc:abc123/app.bsky.feed.post/3kabcdef",
    cid: "bafy",
    author: { did: "did:plc:abc123", handle: "jane.bsky.social", displayName: "Jane" },
    record: {
      text: "Does anyone have a decent invoicing tool that is not awful?",
      createdAt: "2026-09-03T10:00:00.000Z",
    },
    indexedAt: "2026-09-03T10:00:01.000Z",
    likeCount: 4,
    replyCount: 2,
    repostCount: 1,
    quoteCount: 0,
    ...overrides,
  };
}

function sessionHandler(calls: { n: number }) {
  return http.post("https://bsky.social/xrpc/com.atproto.server.createSession", () => {
    calls.n += 1;
    return HttpResponse.json({
      accessJwt: `jwt-${calls.n}`,
      refreshJwt: "refresh",
      did: "did:plc:me",
      handle: "me.bsky.social",
    });
  });
}

describe("bluesky fetchNew", () => {
  it("authenticates then maps a post into a RawItem", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("invoicing tool");
        expect(url.searchParams.get("sort")).toBe("latest");
        expect(request.headers.get("authorization")).toBe("Bearer jwt-1");
        return HttpResponse.json({ posts: [postFixture()] });
      }),
    );

    const result = await adapter().fetchNew(watch(), null);

    expect(calls.n).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: "bluesky",
      // The AT-URI, not the permalink: handles change, DIDs do not.
      externalId: "at://did:plc:abc123/app.bsky.feed.post/3kabcdef",
      url: "https://bsky.app/profile/jane.bsky.social/post/3kabcdef",
      author: "jane.bsky.social",
      title: null,
      venue: "bsky.app",
      engagement: { likes: 4, replies: 2, reposts: 1, quotes: 0 },
    });
  });

  it("stops at the cursor instead of re-reading old posts", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        HttpResponse.json({
          posts: [
            postFixture({ indexedAt: "2026-09-03T10:00:01.000Z" }),
            postFixture({
              uri: "at://did:plc:abc123/app.bsky.feed.post/older",
              indexedAt: "2020-01-01T00:00:00.000Z",
            }),
          ],
        }),
      ),
    );

    const result = await adapter().fetchNew(watch(), {
      kind: "bluesky",
      newestIndexedAt: Date.parse("2026-01-01T00:00:00Z"),
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual({
      kind: "bluesky",
      newestIndexedAt: Date.parse("2026-09-03T10:00:01.000Z"),
    });
  });

  it("holds the cursor when nothing is new", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        HttpResponse.json({ posts: [postFixture()] }),
      ),
    );

    const result = await adapter().fetchNew(watch(), {
      kind: "bluesky",
      newestIndexedAt: Date.parse("2030-01-01T00:00:00Z"),
    });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("re-authenticates once when the token has expired", async () => {
    const calls = { n: 0 };
    let searches = 0;
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () => {
        searches += 1;
        // First search after a cached token fails as expired.
        if (searches === 1) {
          return HttpResponse.json({ error: "ExpiredToken" }, { status: 401 });
        }
        return HttpResponse.json({ posts: [postFixture()] });
      }),
    );

    const bsky = adapter();
    // Prime the cached token, then force it to be rejected.
    await bsky.fetchNew(watch(), { kind: "bluesky", newestIndexedAt: 0 }).catch(() => {});
    const result = await bsky.fetchNew(watch(), null);

    expect(result.items.length).toBeGreaterThan(0);
    // Once at boot, once after the 401.
    expect(calls.n).toBeGreaterThanOrEqual(2);
  });

  it("skips posts with no text rather than emitting an empty body", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        HttpResponse.json({
          posts: [postFixture({ record: { text: "   ", createdAt: "2026-09-03T10:00:00.000Z" } })],
        }),
      ),
    );
    const result = await adapter().fetchNew(watch(), null);
    expect(result.items).toEqual([]);
  });

  it("refuses a watch with no include terms", async () => {
    await expect(
      adapter().fetchNew(watch({ includeTerms: [] }), null),
    ).rejects.toThrow(/no include terms/);
  });

  it("fails loudly when the payload shape changes", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        // `posts` missing entirely — an upstream shape change must not surface
        // as an empty digest.
        HttpResponse.json({ items: [] }),
      ),
    );
    await expect(adapter().fetchNew(watch(), null)).rejects.toThrow();
  });
});
