/**
 * RSS / Atom adapter (ARCHITECTURE.md section 4.1).
 *
 * The generic escape hatch: any forum, blog, changelog or job board with a
 * feed becomes a source without new code. In practice this is the answer to
 * "can you also watch X?" for most values of X, which is why it is worth more
 * than its size suggests.
 *
 * Two things make RSS harder than a JSON API:
 *
 *   1. **There is no one format.** RSS 2.0 nests items under `rss.channel.item`
 *      with `pubDate`; Atom puts `entry` under `feed` with `published` or
 *      `updated`; both are widely bent. So parsing is deliberately tolerant —
 *      read whichever shape is present, and skip an entry rather than fail a
 *      whole feed over one malformed date.
 *   2. **Feeds are supplied by the customer.** A URL from a settings form is
 *      attacker-controlled input pointed at our own network, so it is
 *      validated before it is fetched, not after.
 *
 * There is no shared rate limiter here: each feed is a different host, and one
 * customer's blog roll should not be throttled by another's. The per-poll
 * ceiling is what bounds the work.
 */
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

import { AdapterError } from "./http.ts";
import {
  cursorFor,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "rss" as const;

/** Feeds fetched per poll. Beyond this the poll takes longer than its interval. */
const MAX_FEEDS = 10;

/** Entries taken from any single feed, newest first. */
const MAX_ENTRIES_PER_FEED = 50;

/** First run has no cursor; a week back matches the other adapters. */
const COLD_START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const FEED_TIMEOUT_MS = 15_000;

/** Below this, a "body" is feed boilerplate rather than content. */
const MIN_BODY_CHARS = 25;

export interface RssAdapterOptions {
  /** Injected in tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Where the customer's feed URLs live: `sourceConfig.rss.feeds`.
 */
const sourceConfigSchema = z.object({
  rss: z
    .object({
      feeds: z.array(z.string()).optional(),
    })
    .optional(),
});

export function createRssAdapter(options: RssAdapterOptions = {}): SourceAdapter {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    source: SOURCE,

    async fetchNew(
      watch: WatchConfig,
      previous: Cursor | null,
    ): Promise<FetchResult> {
      const feeds = resolveFeeds(watch);
      if (feeds.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has no feed URLs; set sourceConfig.rss.feeds`,
        );
      }

      const previousCursor = cursorFor("rss", previous);
      const since =
        previousCursor?.newestPublishedAt ?? Date.now() - COLD_START_LOOKBACK_MS;

      const items: RawItem[] = [];
      const seen = new Set<string>();
      const warnings: string[] = [];
      let newest = since;
      let calls = 0;

      for (const feed of feeds.slice(0, MAX_FEEDS)) {
        calls += 1;
        let xml: string;
        try {
          xml = await fetchFeed(doFetch, feed);
        } catch (error) {
          // One dead feed must not cost the customer every other feed's
          // items, so it degrades to a warning the digest can surface.
          warnings.push(
            `feed ${feed} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        let entries: ParsedEntry[];
        try {
          entries = parseFeed(xml);
        } catch (error) {
          warnings.push(
            `feed ${feed} did not parse: ${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }

        if (entries.length === 0) {
          warnings.push(`feed ${feed} contained no entries`);
          continue;
        }

        for (const entry of entries.slice(0, MAX_ENTRIES_PER_FEED)) {
          const published = entry.publishedAt?.getTime() ?? null;
          // No date means we cannot tell new from old, and re-emitting every
          // entry on every poll would be worse than skipping it. The unique
          // index would dedup it anyway, but the classifier bill would not.
          if (published === null || published <= since) continue;

          const item = toRawItem(entry, feed);
          if (item === null || seen.has(item.externalId)) continue;
          seen.add(item.externalId);
          items.push(item);
          if (published > newest) newest = published;
        }
      }

      return {
        items,
        nextCursor:
          newest > since ? { kind: SOURCE, newestPublishedAt: newest } : null,
        cost: { calls },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  };
}

// --- feed configuration -----------------------------------------------------

/**
 * Read and validate the customer's feed URLs.
 *
 * Rejects anything that is not http(s), which is the check that matters: these
 * URLs come from a settings form and are fetched by our own server, so
 * `file://` and friends would be a read primitive against the worker's
 * filesystem.
 */
export function resolveFeeds(watch: WatchConfig): string[] {
  const parsed = sourceConfigSchema.safeParse(watch.sourceConfig ?? {});
  if (!parsed.success) return [];
  const configured = parsed.data.rss?.feeds ?? [];

  const out: string[] = [];
  for (const candidate of configured) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    out.push(url.toString());
  }
  return [...new Set(out)];
}

// --- fetching and parsing ---------------------------------------------------

async function fetchFeed(doFetch: typeof fetch, url: string): Promise<string> {
  // Not fetchJson: feeds are XML, and the shared helper parses JSON. The error
  // taxonomy is reproduced here rather than bent around.
  const response = await doFetch(url, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "user-agent": "intentowl/0.1",
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new AdapterError(SOURCE, `HTTP ${response.status}`);
  }
  return await response.text();
}

export interface ParsedEntry {
  id: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
  author: string | null;
  publishedAt: Date | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

/**
 * Parse RSS 2.0 or Atom into a common shape.
 *
 * Kept tolerant on purpose: real feeds in the wild omit ids, put HTML in
 * titles, and date-format creatively. Anything unreadable becomes null and is
 * skipped upstream, rather than throwing away the rest of the feed.
 */
export function parseFeed(xml: string): ParsedEntry[] {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const rss = doc["rss"] as { channel?: unknown } | undefined;
  const channel = rss?.channel as { item?: unknown } | undefined;
  if (channel !== undefined) {
    return asArray(channel.item).map(parseRssItem);
  }

  const feed = doc["feed"] as { entry?: unknown } | undefined;
  if (feed !== undefined) {
    return asArray(feed.entry).map(parseAtomEntry);
  }

  // RDF-flavoured RSS 1.0 puts items at the top level.
  const rdf = doc["rdf:RDF"] as { item?: unknown } | undefined;
  if (rdf !== undefined) {
    return asArray(rdf.item).map(parseRssItem);
  }

  return [];
}

function parseRssItem(raw: unknown): ParsedEntry {
  const item = (raw ?? {}) as Record<string, unknown>;
  const link = text(item["link"]);
  return {
    id: text(item["guid"]) ?? link,
    title: text(item["title"]),
    body:
      text(item["content:encoded"]) ??
      text(item["description"]) ??
      null,
    link,
    author: text(item["author"]) ?? text(item["dc:creator"]),
    publishedAt: parseDate(text(item["pubDate"]) ?? text(item["dc:date"])),
  };
}

function parseAtomEntry(raw: unknown): ParsedEntry {
  const entry = (raw ?? {}) as Record<string, unknown>;

  // Atom links are attribute-bearing and often repeated with rel values;
  // the alternate (or first) href is the human-readable page.
  const links = asArray(entry["link"]);
  let href: string | null = null;
  for (const candidate of links) {
    const l = candidate as Record<string, unknown>;
    const rel = typeof l["@_rel"] === "string" ? l["@_rel"] : "alternate";
    const value = typeof l["@_href"] === "string" ? l["@_href"] : null;
    if (value === null) continue;
    if (rel === "alternate") {
      href = value;
      break;
    }
    href ??= value;
  }

  const author = entry["author"] as { name?: unknown } | undefined;

  return {
    id: text(entry["id"]) ?? href,
    title: text(entry["title"]),
    body: text(entry["content"]) ?? text(entry["summary"]),
    link: href,
    author: text(author?.name),
    publishedAt: parseDate(text(entry["published"]) ?? text(entry["updated"])),
  };
}

function toRawItem(entry: ParsedEntry, feedUrl: string): RawItem | null {
  if (entry.link === null) return null;

  let url: URL;
  try {
    url = new URL(entry.link, feedUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const title = entry.title === null ? null : stripTags(entry.title);
  const stripped = entry.body === null ? null : stripTags(entry.body);
  // Many feeds put a bare link-to-comments in `description`, which strips down
  // to something like "Comments". That is not prose, it is a leftover, and
  // sending it to the classifier costs tokens to read a word that means
  // nothing. Anything this short is treated as no body at all.
  const body = stripped !== null && stripped.length >= MIN_BODY_CHARS ? stripped : null;

  return {
    source: SOURCE,
    // The feed's own id where it has one, else the resolved URL. Both are
    // stable across polls, which is what the unique index needs.
    externalId: entry.id ?? url.toString(),
    url: url.toString(),
    author: entry.author,
    title,
    body,
    venue: hostOf(feedUrl),
    postedAt: entry.publishedAt,
    // Feeds carry no engagement signal. Null rather than zero: zero would be
    // a measurement, and this is an absence.
    engagement: null,
  };
}

// --- small helpers ----------------------------------------------------------

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** XML text nodes arrive as strings, numbers, or `{ "#text": ... }`. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null) {
    const inner = (value as Record<string, unknown>)["#text"];
    if (typeof inner === "string") return inner.trim() || null;
    if (typeof inner === "number") return String(inner);
  }
  return null;
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
