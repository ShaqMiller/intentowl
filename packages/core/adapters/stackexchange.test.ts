import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdapterError, RateLimitedError } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import {
  createStackExchangeAdapter,
  resolveSites,
} from "./stackexchange.ts";
import type { Cursor, WatchConfig } from "./types.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SEARCH = "https://api.stackexchange.com/2.3/search/advanced";

function adapter(apiKey?: string) {
  return createStackExchangeAdapter({
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 100 }),
    ...(apiKey === undefined ? {} : { apiKey }),
  });
}

const watch: WatchConfig = {
  id: "watch-1",
  customerId: "customer-1",
  name: "test watch",
  sources: ["stackexchange"],
  subreddits: [],
  includeTerms: ["find customers"],
  excludeTerms: [],
};

/** Shape taken from a real api.stackexchange.com response. */
function question(overrides: Record<string, unknown> = {}) {
  return {
    question_id: 460745,
    title: "How do I find my first customers?",
    body: "<p>My application uses <b>PostgreSQL</b> &amp; I cannot find users.</p>",
    link: "https://softwareengineering.stackexchange.com/questions/460745/how-do-i",
    creation_date: 1_769_119_208,
    score: 3,
    answer_count: 2,
    view_count: 140,
    is_answered: true,
    tags: ["marketing", "startup"],
    owner: { display_name: "RuslanD" },
    ...overrides,
  };
}

function envelope(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    items,
    has_more: false,
    quota_max: 300,
    quota_remaining: 280,
    ...extra,
  };
}

describe("resolveSites", () => {
  it("defaults when the watch names none", () => {
    expect(resolveSites(watch)).toEqual(["softwareengineering", "stackoverflow"]);
  });

  it("reads sites from sourceConfig", () => {
    expect(
      resolveSites({
        ...watch,
        sourceConfig: { stackexchange: { sites: ["webmasters"] } },
      }),
    ).toEqual(["webmasters"]);
  });

  it("caps the site count — quota is shared across every customer", () => {
    const sites = resolveSites({
      ...watch,
      sourceConfig: { stackexchange: { sites: ["a", "b", "c", "d", "e"] } },
    });
    expect(sites).toHaveLength(3);
  });

  it("ignores junk in the config rather than failing the poll", () => {
    expect(
      resolveSites({ ...watch, sourceConfig: { stackexchange: { sites: "nope" } } }),
    ).toEqual(["softwareengineering", "stackoverflow"]);
  });
});

describe("stackexchange adapter", () => {
  it("normalises a question and strips the HTML body", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json(envelope([question()]))));

    const result = await adapter().fetchNew(
      { ...watch, sourceConfig: { stackexchange: { sites: ["softwareengineering"] } } },
      null,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: "stackexchange",
      externalId: "460745",
      title: "How do I find my first customers?",
      author: "RuslanD",
      venue: "softwareengineering.stackexchange.com",
    });
    // Entities decoded, tags gone.
    expect(result.items[0]?.body).toBe(
      "My application uses PostgreSQL & I cannot find users.",
    );
  });

  it("asks only for questions newer than the cursor", async () => {
    let fromdate: string | null = null;
    server.use(
      http.get(SEARCH, ({ request }) => {
        fromdate = new URL(request.url).searchParams.get("fromdate");
        return HttpResponse.json(envelope([]));
      }),
    );

    const previous: Cursor = { kind: "stackexchange", newestCreatedAt: 1_760_000_000 };
    await adapter().fetchNew(
      { ...watch, sourceConfig: { stackexchange: { sites: ["softwareengineering"] } } },
      previous,
    );
    expect(fromdate).toBe("1760000000");
  });

  it("sends the API key when one is configured", async () => {
    let key: string | null = null;
    server.use(
      http.get(SEARCH, ({ request }) => {
        key = new URL(request.url).searchParams.get("key");
        return HttpResponse.json(envelope([]));
      }),
    );
    await adapter("test-key").fetchNew(
      { ...watch, sourceConfig: { stackexchange: { sites: ["softwareengineering"] } } },
      null,
    );
    expect(key).toBe("test-key");
  });

  it("treats a backoff instruction as a reschedule, not a sleep", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json(envelope([question()], { backoff: 10 })),
      ),
    );
    // Ignoring backoff is how an app gets its key throttled.
    await expect(
      adapter().fetchNew(
        { ...watch, sourceConfig: { stackexchange: { sites: ["softwareengineering"] } } },
        null,
      ),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("stops early and warns when the shared quota runs low", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json(envelope([question()], { quota_remaining: 5 })),
      ),
    );

    const result = await adapter().fetchNew(
      {
        ...watch,
        includeTerms: ["a", "b", "c"],
        sourceConfig: { stackexchange: { sites: ["softwareengineering"] } },
      },
      null,
    );

    expect(result.cost.calls).toBe(1);
    expect(result.warnings?.join(" ")).toContain("quota");
  });

  it("caps requests per poll, tighter without a key", async () => {
    let calls = 0;
    server.use(
      http.get(SEARCH, () => {
        calls += 1;
        return HttpResponse.json(envelope([]));
      }),
    );

    // 300/day shared across customers cannot survive an unbounded loop.
    await adapter().fetchNew(
      { ...watch, includeTerms: ["a", "b", "c", "d", "e", "f", "g", "h"] },
      null,
    );
    expect(calls).toBeLessThanOrEqual(6);

    calls = 0;
    // A key buys 10,000/day, so every term can be searched.
    await adapter("k").fetchNew(
      { ...watch, includeTerms: ["a", "b", "c", "d", "e", "f", "g", "h"] },
      null,
    );
    expect(calls).toBeGreaterThan(6);
    expect(calls).toBeLessThanOrEqual(24);
  });

  it("names the terms it cannot afford to search", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json(envelope([]))));
    // One cursor covers the whole source, so a skipped term is not delayed --
    // the cursor moves past its window and those posts are never seen.
    const result = await adapter().fetchNew(
      {
        ...watch,
        // Seven terms against a six-request anonymous budget on one site.
        includeTerms: ["a", "b", "c", "d", "e", "f", "skipped-term"],
        sourceConfig: { stackexchange: { sites: ["softwareengineering"] } },
      },
      null,
    );
    expect(result.warnings?.join(" ")).toContain("skipped-term");
  });

  it("advances the cursor to the newest question seen", async () => {
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json(
          envelope([
            question({ question_id: 1, creation_date: 1_769_000_000 }),
            question({ question_id: 2, creation_date: 1_769_999_999 }),
          ]),
        ),
      ),
    );
    const result = await adapter().fetchNew(
      { ...watch, sourceConfig: { stackexchange: { sites: ["softwareengineering"] } } },
      { kind: "stackexchange", newestCreatedAt: 1_760_000_000 },
    );
    expect(result.nextCursor).toEqual({
      kind: "stackexchange",
      newestCreatedAt: 1_769_999_999,
    });
  });

  it("refuses to run without include terms", async () => {
    await expect(
      adapter().fetchNew({ ...watch, includeTerms: [] }, null),
    ).rejects.toBeInstanceOf(AdapterError);
  });

  it("skips a bad site with a warning instead of failing the whole poll", async () => {
    let n = 0;
    server.use(
      http.get(SEARCH, ({ request }) => {
        n += 1;
        const site = new URL(request.url).searchParams.get("site");
        // Real behaviour: an unknown site name is a 400, not an empty result.
        if (site === "nosuchsite") {
          return HttpResponse.json(
            { error_id: 400, error_message: 'No site found for name ' },
            { status: 400 },
          );
        }
        return HttpResponse.json(envelope([question()]));
      }),
    );

    const result = await adapter().fetchNew(
      {
        ...watch,
        sourceConfig: { stackexchange: { sites: ["nosuchsite", "softwareengineering"] } },
      },
      null,
    );

    expect(n).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.warnings?.join(" ")).toContain("nosuchsite");
  });

  it("reads the venue off the item link, not the site key", async () => {
    // Stack Overflow is stackoverflow.com, not stackoverflow.stackexchange.com.
    server.use(
      http.get(SEARCH, () =>
        HttpResponse.json(
          envelope([
            question({ link: "https://stackoverflow.com/questions/1/how-do-i" }),
          ]),
        ),
      ),
    );
    const result = await adapter().fetchNew(
      { ...watch, sourceConfig: { stackexchange: { sites: ["stackoverflow"] } } },
      null,
    );
    expect(result.items[0]?.venue).toBe("stackoverflow.com");
  });

  it("rejects a payload whose shape changed upstream", async () => {
    server.use(
      http.get(SEARCH, () => HttpResponse.json(envelope([{ title: "no id" }]))),
    );
    await expect(
      adapter().fetchNew(
        { ...watch, sourceConfig: { stackexchange: { sites: ["softwareengineering"] } } },
        null,
      ),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});
