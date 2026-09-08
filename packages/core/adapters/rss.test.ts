/**
 * RSS adapter tests.
 *
 * Feeds are the one source whose input a customer controls directly, so the
 * URL validation cases carry as much weight as the parsing ones.
 */
import { describe, expect, it } from "vitest";

import { createRssAdapter, parseFeed, resolveFeeds } from "./rss.ts";
import type { WatchConfig } from "./types.ts";

function watch(overrides: Partial<WatchConfig> = {}): WatchConfig {
  return {
    id: "w1",
    customerId: "c1",
    name: "test",
    sources: ["rss"],
    subreddits: [],
    includeTerms: [],
    excludeTerms: [],
    ...overrides,
  };
}

const RSS_2 = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Example Blog</title>
    <item>
      <title>Finding your first customers</title>
      <link>https://example.com/posts/first-customers</link>
      <guid isPermaLink="false">post-1</guid>
      <description>&lt;p&gt;We spent &lt;b&gt;months&lt;/b&gt; talking to people before anyone paid us.&lt;/p&gt;</description>
      <pubDate>Wed, 03 Sep 2026 10:00:00 GMT</pubDate>
      <dc:creator>Jane</dc:creator>
    </item>
    <item>
      <title>An older post</title>
      <link>https://example.com/posts/older</link>
      <guid>post-0</guid>
      <pubDate>Mon, 01 Jan 2001 10:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom</title>
  <entry>
    <id>tag:example.com,2026:1</id>
    <title>Atom entry title</title>
    <link rel="edit" href="https://example.com/edit/1"/>
    <link rel="alternate" href="https://example.com/atom/1"/>
    <published>2026-09-03T10:00:00Z</published>
    <author><name>Sam</name></author>
    <summary>Some summary text.</summary>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads RSS 2.0 items", () => {
    const entries = parseFeed(RSS_2);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "post-1",
      title: "Finding your first customers",
      link: "https://example.com/posts/first-customers",
      author: "Jane",
    });
    expect(entries[0]?.publishedAt?.toISOString()).toBe("2026-09-03T10:00:00.000Z");
  });

  it("reads Atom entries and prefers the alternate link", () => {
    const entries = parseFeed(ATOM);
    expect(entries).toHaveLength(1);
    // The edit link comes first in the document; the alternate is the one a
    // human would open, and the one worth classifying.
    expect(entries[0]).toMatchObject({
      id: "tag:example.com,2026:1",
      link: "https://example.com/atom/1",
      author: "Sam",
    });
  });

  it("handles a single-item feed, which parsers hand back unwrapped", () => {
    const single = RSS_2.replace(
      /<item>\s*<title>An older post[\s\S]*?<\/item>/,
      "",
    );
    expect(parseFeed(single)).toHaveLength(1);
  });

  it("returns nothing for XML that is not a feed", () => {
    expect(parseFeed("<html><body>not a feed</body></html>")).toEqual([]);
  });
});

describe("resolveFeeds", () => {
  it("reads feeds out of sourceConfig", () => {
    const feeds = resolveFeeds(
      watch({ sourceConfig: { rss: { feeds: ["https://example.com/feed.xml"] } } }),
    );
    expect(feeds).toEqual(["https://example.com/feed.xml"]);
  });

  it("rejects non-http schemes", () => {
    // These URLs come from a customer form and are fetched by our own server,
    // so file:// would be a read primitive against the worker's disk.
    const feeds = resolveFeeds(
      watch({
        sourceConfig: {
          rss: {
            feeds: [
              "file:///etc/passwd",
              "ftp://example.com/feed",
              "javascript:alert(1)",
              "https://good.example/feed.xml",
            ],
          },
        },
      }),
    );
    expect(feeds).toEqual(["https://good.example/feed.xml"]);
  });

  it("drops unparseable URLs and duplicates", () => {
    const feeds = resolveFeeds(
      watch({
        sourceConfig: {
          rss: {
            feeds: ["not a url", "https://a.example/f", "https://a.example/f"],
          },
        },
      }),
    );
    expect(feeds).toEqual(["https://a.example/f"]);
  });

  it("returns nothing when sourceConfig is absent or the wrong shape", () => {
    expect(resolveFeeds(watch())).toEqual([]);
    expect(resolveFeeds(watch({ sourceConfig: { rss: { feeds: "nope" } } }))).toEqual([]);
  });
});

describe("fetchNew", () => {
  function stubFetch(body: string, status = 200): typeof fetch {
    return (async () =>
      new Response(body, { status, headers: { "content-type": "application/xml" } })) as unknown as typeof fetch;
  }

  const config = { rss: { feeds: ["https://example.com/feed.xml"] } };

  it("returns entries newer than the cursor and advances it", async () => {
    const adapter = createRssAdapter({ fetchImpl: stubFetch(RSS_2) });
    const result = await adapter.fetchNew(watch({ sourceConfig: config }), {
      kind: "rss",
      newestPublishedAt: Date.parse("2026-01-01T00:00:00Z"),
    });

    // Only the 2026 post is newer than the cursor; the 2001 one is filtered.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: "rss",
      externalId: "post-1",
      url: "https://example.com/posts/first-customers",
      title: "Finding your first customers",
      venue: "example.com",
      engagement: null,
    });
    // HTML is stripped so the classifier reads prose, not markup.
    expect(result.items[0]?.body).toBe(
      "We spent months talking to people before anyone paid us.",
    );
    expect(result.nextCursor).toEqual({
      kind: "rss",
      newestPublishedAt: Date.parse("2026-09-03T10:00:00Z"),
    });
  });

  it("drops feed boilerplate that is not really a body", async () => {
    // Hacker News puts a bare link-to-comments in <description>, which strips
    // to the single word "Comments". Sending that to the classifier costs
    // tokens to read a word that carries nothing.
    const boilerplate = RSS_2.replace(
      /<description>[\s\S]*?<\/description>/,
      "<description>&lt;a href=&quot;https://example.com/c&quot;&gt;Comments&lt;/a&gt;</description>",
    );
    const adapter = createRssAdapter({ fetchImpl: stubFetch(boilerplate) });
    const result = await adapter.fetchNew(watch({ sourceConfig: config }), {
      kind: "rss",
      newestPublishedAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(result.items[0]?.title).toBe("Finding your first customers");
    expect(result.items[0]?.body).toBeNull();
  });

  it("holds the cursor when nothing is new", async () => {
    const adapter = createRssAdapter({ fetchImpl: stubFetch(RSS_2) });
    const result = await adapter.fetchNew(watch({ sourceConfig: config }), {
      kind: "rss",
      newestPublishedAt: Date.parse("2030-01-01T00:00:00Z"),
    });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("warns rather than throws when a feed is dead", async () => {
    const adapter = createRssAdapter({ fetchImpl: stubFetch("nope", 500) });
    const result = await adapter.fetchNew(watch({ sourceConfig: config }), null);
    // One broken feed must not cost the customer their other feeds.
    expect(result.items).toEqual([]);
    expect(result.warnings?.[0]).toContain("HTTP 500");
  });

  it("throws when the watch has no feeds at all", async () => {
    const adapter = createRssAdapter({ fetchImpl: stubFetch(RSS_2) });
    await expect(adapter.fetchNew(watch(), null)).rejects.toThrow(/no feed URLs/);
  });

  it("counts one call per feed", async () => {
    const adapter = createRssAdapter({ fetchImpl: stubFetch(RSS_2) });
    const result = await adapter.fetchNew(
      watch({
        sourceConfig: {
          rss: { feeds: ["https://a.example/f", "https://b.example/f"] },
        },
      }),
      null,
    );
    expect(result.cost.calls).toBe(2);
  });
});
