/**
 * Bluesky adapter tests.
 *
 * The fixtures below were checked against a real authenticated response on
 * 2026-09-09 — field names, types and the descending `indexedAt` ordering all
 * match. They cover the branches a live probe cannot reach on demand: an
 * expired token, a post with no text, and an upstream shape change.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

/**
 * Timestamps are relative to now, not fixed dates.
 *
 * They were hardcoded to 2026-09-03, which passed the day they were written
 * and started failing a week later: the adapter's cold start looks back seven
 * days, so the fixtures aged out of their own window. A test whose result
 * depends on the calendar is worse than no test, because it fails loudly for a
 * reason that has nothing to do with the code.
 */
const RECENT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const RECENT_INDEXED = new Date(Date.now() - 59 * 60 * 1000).toISOString();

function postFixture(overrides: Record<string, unknown> = {}) {
  return {
    uri: "at://did:plc:abc123/app.bsky.feed.post/3kabcdef",
    cid: "bafy",
    author: { did: "did:plc:abc123", handle: "jane.bsky.social", displayName: "Jane" },
    record: {
      text: "Does anyone have a decent invoicing tool that is not awful?",
      createdAt: RECENT,
    },
    indexedAt: RECENT_INDEXED,
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
            postFixture({ indexedAt: RECENT_INDEXED }),
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
      newestIndexedAt: Date.now() - 2 * 60 * 60 * 1000,
    });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toEqual({
      kind: "bluesky",
      newestIndexedAt: Date.parse(RECENT_INDEXED),
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
      newestIndexedAt: Date.now() + 60 * 60 * 1000,
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

describe("bluesky rejected requests", () => {
  it("does not let one rejected term silence the others", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        if (q === "bad term") {
          return HttpResponse.json({ error: "BadQueryString" }, { status: 400 });
        }
        return HttpResponse.json({ posts: [postFixture()] });
      }),
    );

    const result = await adapter().fetchNew(
      watch({ includeTerms: ["bad term", "good term"] }),
      null,
    );

    // Before the fix, the 400 on the first term threw and the second term was
    // never asked — the whole source went quiet over one request.
    expect(result.items).toHaveLength(1);
    expect(result.warnings?.some((w) => w.includes("bad term"))).toBe(true);
  });

  it("keeps the first page when a later page is rejected", async () => {
    const calls = { n: 0 };
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      postFixture({ uri: `at://did:plc:abc123/app.bsky.feed.post/p${i}` }),
    );
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", ({ request }) => {
        if (new URL(request.url).searchParams.has("cursor")) {
          return HttpResponse.json({ error: "InvalidRequest" }, { status: 400 });
        }
        return HttpResponse.json({ posts: fullPage, cursor: "page-two" });
      }),
    );

    const result = await adapter().fetchNew(watch(), null);

    expect(result.items).toHaveLength(100);
    expect(result.warnings?.some((w) => w.includes("page 2"))).toBe(true);
  });

  it("renews a session Bluesky reports as expired with a 400", async () => {
    // What the live AppView actually sends for an expired access token. The
    // adapter only recognised 401, so every term was "rejected" and the
    // source returned nothing from 15 to 21 September.
    const calls = { n: 0 };
    let searches = 0;
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () => {
        searches += 1;
        if (searches === 1) {
          return HttpResponse.json(
            { error: "ExpiredToken", message: "Token has expired" },
            { status: 400 },
          );
        }
        return HttpResponse.json({ posts: [postFixture()] });
      }),
    );

    const result = await adapter().fetchNew(watch(), null);

    expect(result.items).toHaveLength(1);
    expect(calls.n).toBe(2);
    expect(result.warnings).toBeUndefined();
  });

  it("renews a session older than 90 minutes before searching", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        HttpResponse.json({ posts: [postFixture()] }),
      ),
    );

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const bsky = adapter();
      await bsky.fetchNew(watch(), null);
      await bsky.fetchNew(watch(), null);
      expect(calls.n).toBe(1);

      vi.setSystemTime(Date.now() + 91 * 60 * 1000);
      await bsky.fetchNew(watch(), null);
      expect(calls.n).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails the poll when every term is rejected", async () => {
    const calls = { n: 0 };
    server.use(
      sessionHandler(calls),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        HttpResponse.json({ error: "BadQueryString" }, { status: 400 }),
      ),
    );

    await expect(
      adapter().fetchNew(watch({ includeTerms: ["a", "b"] }), null),
    ).rejects.toThrow(/every Bluesky search this poll was rejected \(2 of 2\).*BadQueryString/);
  });

  it("still fails loudly when the credentials are wrong", async () => {
    server.use(
      http.post("https://bsky.social/xrpc/com.atproto.server.createSession", () =>
        HttpResponse.json({ accessJwt: "jwt", did: "did:plc:me" }),
      ),
      http.get("https://bsky.social/xrpc/app.bsky.feed.searchPosts", () =>
        HttpResponse.json({ error: "AuthRequired" }, { status: 401 }),
      ),
    );

    // A 401 that survives a fresh session is a configuration problem. It must
    // reach the operator as a failed job, not hide inside a warning.
    await expect(adapter().fetchNew(watch(), null)).rejects.toThrow(/401/);
  });
});
