/**
 * Threads adapter tests.
 *
 * Fixtures follow Meta's documented keyword-search response, not a recorded
 * one: public search needs an approved permission this account does not have
 * yet. When the first real poll lands, compare it against these and update
 * whichever is wrong.
 */
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TokenBucket } from "./rate-limit.ts";
import { createThreadsAdapter, parseThreadsTimestamp, toRawItem } from "./threads.ts";
import type { WatchConfig } from "./types.ts";

const SEARCH = "https://graph.threads.net/v1.0/keyword_search";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function fastBucket(): TokenBucket {
  return new TokenBucket({ capacity: 1000, refillPerSecond: 1000 });
}

function adapter(bucket: TokenBucket = fastBucket()) {
  return createThreadsAdapter({ getAccessToken: async () => "th-token", bucket });
}

function watch(overrides: Partial<WatchConfig> = {}): WatchConfig {
  return {
    id: "w1",
    customerId: "c1",
    name: "test",
    sources: ["threads" as WatchConfig["sources"][number]],
    subreddits: [],
    includeTerms: ["first customers"],
    excludeTerms: [],
    ...overrides,
  };
}

/** Meta's offset style, an hour ago — relative so the cold-start window never ages it out. */
function metaTimestamp(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, "+0000");
}

function postFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "18000000000000001",
    text: "Launched my SaaS a month ago and still zero paying customers. Where do you find your first ones?",
    media_type: "TEXT",
    permalink: "https://www.threads.net/@jane/post/Cabc123",
    timestamp: metaTimestamp(60 * 60 * 1000),
    username: "jane",
    has_replies: true,
    is_quote_post: false,
    is_reply: false,
    ...overrides,
  };
}

describe("toRawItem", () => {
  it("maps a documented post", () => {
    const item = toRawItem(postFixture());
    expect(item).toMatchObject({
      source: "threads",
      externalId: "18000000000000001",
      url: "https://www.threads.net/@jane/post/Cabc123",
      author: "jane",
      title: null,
      venue: "threads.net",
      engagement: { hasReplies: true, isReply: false, isQuote: false },
    });
    expect(item?.postedAt).toBeInstanceOf(Date);
  });

  it("drops posts with no text or no permalink", () => {
    expect(toRawItem(postFixture({ text: "   " }))).toBeNull();
    expect(toRawItem(postFixture({ text: null }))).toBeNull();
    expect(toRawItem(postFixture({ permalink: null }))).toBeNull();
  });

  it("parses Meta's colon-less offsets", () => {
    expect(parseThreadsTimestamp("2023-10-17T05:42:03+0000")?.toISOString()).toBe(
      "2023-10-17T05:42:03.000Z",
    );
    expect(parseThreadsTimestamp("2023-10-17T07:42:03+0200")?.toISOString()).toBe(
      "2023-10-17T05:42:03.000Z",
    );
    expect(parseThreadsTimestamp("not a date")).toBeNull();
    expect(parseThreadsTimestamp(null)).toBeNull();
  });
});

describe("fetchNew", () => {
  it("searches recent posts from the cursor forward and advances it", async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(SEARCH, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ data: [postFixture()] });
      }),
    );

    const cursorAt = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
    const result = await adapter().fetchNew(watch(), { kind: "threads", newestTimestamp: cursorAt });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.get("q")).toBe("first customers");
    expect(seen[0]?.get("search_type")).toBe("RECENT");
    expect(seen[0]?.get("since")).toBe(String(cursorAt));
    expect(seen[0]?.get("access_token")).toBe("th-token");
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toMatchObject({ kind: "threads" });
    expect((result.nextCursor as { newestTimestamp: number }).newestTimestamp).toBeGreaterThan(cursorAt);
    expect(result.warnings).toBeUndefined();
  });

  it("dedupes a post matched by two terms", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ data: [postFixture()] })));
    const result = await adapter().fetchNew(watch({ includeTerms: ["first customers", "paying customers"] }), null);
    expect(result.items).toHaveLength(1);
    expect(result.cost.calls).toBe(2);
  });

  it("keeps searching when one term is rejected", async () => {
    server.use(
      http.get(SEARCH, ({ request }) =>
        new URL(request.url).searchParams.get("q") === "bad term"
          ? HttpResponse.json({ error: { message: "Invalid parameter" } }, { status: 400 })
          : HttpResponse.json({ data: [postFixture()] }),
      ),
    );
    const result = await adapter().fetchNew(watch({ includeTerms: ["bad term", "first customers"] }), null);
    expect(result.items).toHaveLength(1);
    expect(result.warnings?.some((w) => w.includes('"bad term" was rejected'))).toBe(true);
  });

  it("fails the poll when every search is rejected — the token, not the terms", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({ error: { message: "Error validating access token", code: 190 } }, { status: 400 }),
      ),
    );
    await expect(
      adapter().fetchNew(watch({ includeTerms: ["a", "b"] }), null),
    ).rejects.toThrow(/every Threads search this poll was rejected/);
  });

  it("stops at the daily budget instead of waiting for it", async () => {
    let requests = 0;
    server.use(
      http.get(SEARCH, () => {
        requests += 1;
        return HttpResponse.json({ data: [] });
      }),
    );
    const oneSearchLeft = new TokenBucket({ capacity: 1, refillPerSecond: 0 });
    const result = await adapter(oneSearchLeft).fetchNew(watch({ includeTerms: ["a", "b", "c"] }), null);
    expect(requests).toBe(1);
    expect(result.warnings?.some((w) => w.includes("budget reached; 2 of 3 terms"))).toBe(true);
  });

  it("warns when a term fills the page", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          data: Array.from({ length: 100 }, (_, i) => postFixture({ id: `id-${i}` })),
        }),
      ),
    );
    const result = await adapter().fetchNew(watch(), null);
    expect(result.items).toHaveLength(100);
    expect(result.warnings?.some((w) => w.includes("full page of 100"))).toBe(true);
  });

  it("warns about terms past the per-poll cap", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ data: [] })));
    const terms = Array.from({ length: 32 }, (_, i) => `term ${i}`);
    const result = await adapter().fetchNew(watch({ includeTerms: terms }), null);
    expect(result.cost.calls).toBe(30);
    expect(result.warnings?.some((w) => w.includes("term 30, term 31"))).toBe(true);
  });

  it("rejects a response whose shape changed", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ results: [] })));
    await expect(adapter().fetchNew(watch(), null)).rejects.toThrow();
  });
});
