import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdapterError } from "./http.ts";
import { createLobstersAdapter } from "./lobsters.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { Cursor, WatchConfig } from "./types.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NEWEST = "https://lobste.rs/newest.json";

function adapter() {
  return createLobstersAdapter({
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 100 }),
  });
}

const watch: WatchConfig = {
  id: "watch-1",
  customerId: "customer-1",
  name: "test watch",
  sources: ["lobsters"],
  subreddits: [],
  includeTerms: ["monitor reddit"],
  excludeTerms: [],
};

/** Shape taken from a real lobste.rs/newest.json response. */
function story(overrides: Record<string, unknown> = {}) {
  return {
    short_id: "2yrepa",
    short_id_url: "https://lobste.rs/s/2yrepa",
    created_at: "2026-09-07T14:49:00.961-05:00",
    title: "Evaluating Performance and Correctness",
    url: "https://example.com/article",
    score: 12,
    flags: 0,
    comment_count: 4,
    description: "<p>A <em>long</em> writeup.</p>",
    description_plain: "A long writeup.",
    submitter_user: "typesanitizer",
    tags: ["performance", "testing"],
    comments_url: "https://lobste.rs/s/2yrepa/evaluating_performance",
    ...overrides,
  };
}

describe("lobsters adapter", () => {
  it("normalises a story and links to the comments, not the article", () => {
    server.use(http.get(NEWEST, () => HttpResponse.json([story()])));

    return adapter()
      .fetchNew(watch, null)
      .then((result) => {
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
          source: "lobsters",
          externalId: "2yrepa",
          // The conversation is where a reply can be posted.
          url: "https://lobste.rs/s/2yrepa/evaluating_performance",
          author: "typesanitizer",
          venue: "lobste.rs/t/performance",
          body: "A long writeup.",
        });
        expect(result.items[0]?.engagement).toMatchObject({
          externalUrl: "https://example.com/article",
        });
      });
  });

  it("stops paging as soon as it reaches the cursor", async () => {
    const pages: string[] = [];
    server.use(
      http.get(NEWEST, ({ request }) => {
        pages.push(new URL(request.url).searchParams.get("page") ?? "1");
        return HttpResponse.json([
          story({ short_id: "new1", created_at: "2026-09-07T12:00:00.000Z" }),
          // Older than the cursor: everything after is already seen.
          story({ short_id: "old1", created_at: "2026-09-01T12:00:00.000Z" }),
        ]);
      }),
    );

    const previous: Cursor = {
      kind: "lobsters",
      newestCreatedAt: Date.parse("2026-09-05T00:00:00.000Z"),
    };
    const result = await adapter().fetchNew(watch, previous);

    expect(result.items.map((i) => i.externalId)).toEqual(["new1"]);
    // One page only — no reason to walk further back.
    expect(pages).toEqual(["1"]);
  });

  it("advances the cursor to the newest story seen", async () => {
    server.use(
      http.get(NEWEST, () =>
        HttpResponse.json([
          story({ short_id: "a", created_at: "2026-09-07T12:00:00.000Z" }),
          story({ short_id: "b", created_at: "2026-09-07T09:00:00.000Z" }),
        ]),
      ),
    );

    const result = await adapter().fetchNew(watch, {
      kind: "lobsters",
      newestCreatedAt: Date.parse("2026-09-06T00:00:00.000Z"),
    });

    expect(result.nextCursor).toEqual({
      kind: "lobsters",
      newestCreatedAt: Date.parse("2026-09-07T12:00:00.000Z"),
    });
  });

  it("holds the cursor still when nothing is newer", async () => {
    server.use(
      http.get(NEWEST, () =>
        HttpResponse.json([story({ created_at: "2026-09-01T12:00:00.000Z" })]),
      ),
    );
    const previous: Cursor = {
      kind: "lobsters",
      newestCreatedAt: Date.parse("2026-09-05T00:00:00.000Z"),
    };
    const result = await adapter().fetchNew(watch, previous);
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toEqual(previous);
  });

  it("falls back to stripping HTML when there is no plain description", async () => {
    server.use(
      http.get(NEWEST, () =>
        HttpResponse.json([
          story({ description_plain: null, description: "<p>Tom &amp; Jerry</p>" }),
        ]),
      ),
    );
    const result = await adapter().fetchNew(watch, null);
    expect(result.items[0]?.body).toBe("Tom & Jerry");
  });

  it("rejects a payload whose shape changed upstream", async () => {
    server.use(
      // short_id gone — our dedup key.
      http.get(NEWEST, () => HttpResponse.json([{ title: "no id" }])),
    );
    await expect(adapter().fetchNew(watch, null)).rejects.toBeInstanceOf(
      AdapterError,
    );
  });

  it("needs no include terms — it has no search API to give them to", async () => {
    server.use(http.get(NEWEST, () => HttpResponse.json([story()])));
    const result = await adapter().fetchNew(
      { ...watch, includeTerms: [] },
      null,
    );
    // Unlike HN and Stack Exchange, browsing is the only mode; the pre-filter
    // does the narrowing instead of the provider.
    expect(result.items).toHaveLength(1);
  });
});
