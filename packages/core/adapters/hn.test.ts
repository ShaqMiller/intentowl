import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createHnAdapter } from "./hn.ts";
import { AdapterError } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { Cursor, WatchConfig } from "./types.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SEARCH = "https://hn.algolia.com/api/v1/search_by_date";

function adapter() {
  return createHnAdapter({
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 100 }),
  });
}

const watch: WatchConfig = {
  id: "watch-1",
  customerId: "customer-1",
  name: "test watch",
  sources: ["hn"],
  subreddits: [],
  includeTerms: ["reddit monitoring", "lead gen"],
  excludeTerms: [],
};

describe("hn adapter", () => {
  it("normalises stories and links to the HN thread, not the article", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          hits: [
            {
              objectID: "41000001",
              created_at_i: 1_757_000_000,
              title: "Ask HN: how do you find customers on Reddit?",
              url: "https://example.com/blog-post",
              author: "pg",
              points: 88,
              num_comments: 31,
            },
          ],
        }),
      ),
    );

    const result = await adapter().fetchNew(watch, null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: "hn",
      externalId: "41000001",
      url: "https://news.ycombinator.com/item?id=41000001",
      venue: "news.ycombinator.com",
      author: "pg",
    });
    // The outbound article survives as context, but the link is the thread.
    expect(result.items[0]?.engagement).toMatchObject({
      externalUrl: "https://example.com/blog-post",
    });
    // One request per include term: Algolia ANDs a multi-word query.
    expect(result.cost.calls).toBe(2);
  });

  it("asks only for items newer than the cursor", async () => {
    let filters: string | null = null;
    server.use(
      http.get(SEARCH, ({ request }) => {
        filters = new URL(request.url).searchParams.get("numericFilters");
        return HttpResponse.json({ hits: [] });
      }),
    );

    const previous: Cursor = { kind: "hn", newestCreatedAt: 1_756_000_000 };
    await adapter().fetchNew(watch, previous);

    expect(filters).toBe("created_at_i>1756000000");
  });

  it("advances the cursor to the newest hit seen", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          hits: [
            { objectID: "1", created_at_i: 1_757_000_000, title: "older" },
            { objectID: "2", created_at_i: 1_757_009_999, title: "newest" },
          ],
        }),
      ),
    );

    const result = await adapter().fetchNew(watch, {
      kind: "hn",
      newestCreatedAt: 1_756_000_000,
    });

    expect(result.nextCursor).toEqual({
      kind: "hn",
      newestCreatedAt: 1_757_009_999,
    });
  });

  it("holds the cursor still when nothing new came back", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ hits: [] })));

    const previous: Cursor = { kind: "hn", newestCreatedAt: 1_756_000_000 };
    const result = await adapter().fetchNew(watch, previous);

    expect(result.nextCursor).toEqual(previous);
  });

  it("skips hits with neither a title nor any text", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json({
          hits: [
            { objectID: "1", created_at_i: 1_757_000_000 },
            { objectID: "2", created_at_i: 1_757_000_001, comment_text: "hi" },
          ],
        }),
      ),
    );

    const result = await adapter().fetchNew(watch, null);
    expect(result.items.map((i) => i.externalId)).toEqual(["2"]);
  });

  it("refuses to run without include terms", async () => {
    await expect(
      adapter().fetchNew({ ...watch, includeTerms: [] }, null),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});
