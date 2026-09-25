import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createGithubAdapter, quoteTerm, repoFromApiUrl } from "./github.ts";
import { AdapterError, SchemaError } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import type { Cursor, WatchConfig } from "./types.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SEARCH = "https://api.github.com/search/issues";

function adapter(token?: string) {
  return createGithubAdapter({
    bucket: new TokenBucket({ capacity: 100, refillPerSecond: 100 }),
    ...(token === undefined ? {} : { token }),
  });
}

const watch: WatchConfig = {
  id: "watch-1",
  customerId: "customer-1",
  name: "test watch",
  sources: ["github"],
  subreddits: [],
  includeTerms: ["monitoring alerts"],
  excludeTerms: [],
};

/** Relative, so a fixture cannot rot past the cold-start window. */
const RECENT = new Date(Date.now() - 60 * 60 * 1000).toISOString();

/** Shape taken from a real /search/issues response. */
function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: 2_101_555_001,
    number: 412,
    title: "Alerts fire twice when a check flaps",
    body: "We moved off Pingdom for this and now it happens here too.",
    html_url: "https://github.com/acme/watchdog/issues/412",
    created_at: RECENT,
    state: "open",
    comments: 4,
    repository_url: "https://api.github.com/repos/acme/watchdog",
    user: { login: "octo-dev" },
    labels: [{ name: "bug" }],
    reactions: { total_count: 7 },
    ...overrides,
  };
}

function respond(items: Array<Record<string, unknown>>, seen?: (url: URL) => void) {
  server.use(
    http.get(SEARCH, ({ request }) => {
      seen?.(new URL(request.url));
      return HttpResponse.json({ total_count: items.length, incomplete_results: false, items });
    }),
  );
}

describe("github adapter", () => {
  it("maps an issue onto a RawItem", async () => {
    respond([issue()]);

    const result = await adapter().fetchNew(watch, null);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: "github",
      externalId: "2101555001",
      url: "https://github.com/acme/watchdog/issues/412",
      author: "octo-dev",
      title: "Alerts fire twice when a check flaps",
      venue: "acme/watchdog",
    });
    expect(result.items[0]?.engagement).toMatchObject({
      comments: 4,
      reactions: 7,
      state: "open",
      labels: ["bug"],
    });
    expect(result.cost.calls).toBe(1);
  });

  it("asks for issues only, newest first, since the cursor", async () => {
    let url: URL | undefined;
    respond([], (seen) => (url = seen));

    const cursor: Cursor = {
      kind: "github",
      newestCreatedAt: Date.parse("2026-09-01T00:00:00Z"),
    };
    await adapter().fetchNew(watch, cursor);

    const q = url?.searchParams.get("q") ?? "";
    expect(q).toContain('"monitoring alerts"');
    expect(q).toContain("is:issue");
    expect(q).toContain("created:>=2026-09-01T00:00:00Z");
    expect(url?.searchParams.get("sort")).toBe("created");
  });

  it("advances the cursor to the newest issue seen", async () => {
    const older = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    respond([issue({ id: 1, created_at: older }), issue({ id: 2, created_at: RECENT })]);

    const result = await adapter().fetchNew(watch, null);

    expect(result.nextCursor).toEqual({
      kind: "github",
      newestCreatedAt: Date.parse(RECENT),
    });
  });

  it("drops pull requests that slip through the index", async () => {
    respond([issue({ id: 3, pull_request: { url: "https://api.github.com/…" } }), issue({ id: 4 })]);

    const result = await adapter().fetchNew(watch, null);

    expect(result.items.map((i) => i.externalId)).toEqual(["4"]);
  });

  it("sends the token when one is configured", async () => {
    let auth: string | null = null;
    server.use(
      http.get(SEARCH, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ items: [] });
      }),
    );

    await adapter("ghp_test").fetchNew(watch, null);

    expect(auth).toBe("Bearer ghp_test");
  });

  it("searches three terms without a token and ten with one", async () => {
    const many = { ...watch, includeTerms: Array.from({ length: 12 }, (_, i) => `term${i}`) };

    respond([]);
    const anonymous = await adapter().fetchNew(many, null);
    expect(anonymous.cost.calls).toBe(3);
    expect(anonymous.warnings?.[0]).toContain("never searched");

    respond([]);
    const authed = await adapter("ghp_test").fetchNew(many, null);
    expect(authed.cost.calls).toBe(10);
  });

  it("skips a term GitHub rejects rather than failing the poll", async () => {
    const two = { ...watch, includeTerms: ["bad:term", "good"] };
    server.use(
      http.get(SEARCH, ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        if (q.includes("bad:term")) {
          return HttpResponse.json({ message: "Validation Failed" }, { status: 422 });
        }
        return HttpResponse.json({ items: [issue()] });
      }),
    );

    const result = await adapter().fetchNew(two, null);

    expect(result.items).toHaveLength(1);
    expect(result.warnings?.some((w) => w.includes("bad:term"))).toBe(true);
  });

  it("fails loudly when the payload shape changes", async () => {
    server.use(http.get(SEARCH, () => HttpResponse.json({ items: [{ id: "not-a-number" }] })));

    await expect(adapter().fetchNew(watch, null)).rejects.toBeInstanceOf(SchemaError);
  });

  it("refuses a watch with no include terms", async () => {
    await expect(
      adapter().fetchNew({ ...watch, includeTerms: [] }, null),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});

describe("quoteTerm", () => {
  it("quotes multi-word terms so GitHub matches the phrase", () => {
    expect(quoteTerm("find first customers")).toBe('"find first customers"');
  });

  it("leaves single words and already-quoted terms alone", () => {
    expect(quoteTerm("posthog")).toBe("posthog");
    expect(quoteTerm('"exact phrase"')).toBe('"exact phrase"');
  });
});

describe("repoFromApiUrl", () => {
  it("reads owner/repo off the API url", () => {
    expect(repoFromApiUrl("https://api.github.com/repos/vercel/next.js")).toBe("vercel/next.js");
  });

  it("returns null for anything else", () => {
    expect(repoFromApiUrl(null)).toBeNull();
    expect(repoFromApiUrl("https://api.github.com/user")).toBeNull();
  });
});
