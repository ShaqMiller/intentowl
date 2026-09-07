/**
 * Hacker News adapter via the Algolia HN Search API
 * (ARCHITECTURE.md section 4.1).
 *
 * Free, no auth, generous. It is the cheapest incremental value in the whole
 * system: it thickens every digest at zero marginal cost, which is exactly why
 * the build order puts it second.
 *
 * The index is time-ordered, so the cursor is a single `created_at_i` and
 * incremental polling is one `numericFilters=created_at_i>N` request.
 */
import { z } from "zod";

import { AdapterError, fetchJson } from "./http.ts";
import { hnBucket } from "./rate-limit.ts";
import {
  cursorFor,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "hn" as const;
const SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";

const HITS_PER_PAGE = 100;

/** First run has no cursor; look back a week rather than to 2007. */
const COLD_START_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Algolia ANDs the words in a query, so include terms cannot be concatenated
 * into one request — a five-term query matches nothing. `optionalWords` flips
 * it to OR across every individual word, which matches far too much ("lead",
 * "how", "find"). One request per term is the only shape that means what the
 * watch means.
 */
const MAX_TERMS_PER_POLL = 10;

/** Pages to walk per term before accepting a gap and warning about it. */
const MAX_PAGES_PER_TERM = 3;

const hit = z.object({
  objectID: z.string().min(1),
  created_at_i: z.number().int().nonnegative(),
  title: z.string().nullish(),
  story_title: z.string().nullish(),
  url: z.string().nullish(),
  story_url: z.string().nullish(),
  author: z.string().nullish(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
  points: z.number().nullish(),
  num_comments: z.number().nullish(),
});

const searchResponse = z.object({
  hits: z.array(hit),
});

export interface HnAdapterOptions {
  bucket?: typeof hnBucket;
}

export function createHnAdapter(options: HnAdapterOptions = {}): SourceAdapter {
  const bucket = options.bucket ?? hnBucket;

  return {
    source: SOURCE,

    async fetchNew(
      watch: WatchConfig,
      previous: Cursor | null,
    ): Promise<FetchResult> {
      if (watch.includeTerms.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has no include terms; HN search needs a query`,
        );
      }

      const previousCursor = cursorFor("hn", previous);
      const since =
        previousCursor?.newestCreatedAt ??
        Math.floor(Date.now() / 1000) - COLD_START_LOOKBACK_SECONDS;

      const items: RawItem[] = [];
      const seen = new Set<string>();
      const saturated: string[] = [];
      let newest = since;
      let calls = 0;

      for (const term of watch.includeTerms.slice(0, MAX_TERMS_PER_POLL)) {
        for (let page = 0; page < MAX_PAGES_PER_TERM; page += 1) {
          await bucket.take();
          calls += 1;

          const url = `${SEARCH_URL}?${new URLSearchParams({
            query: term,
            tags: "(story,comment)",
            hitsPerPage: String(HITS_PER_PAGE),
            page: String(page),
            numericFilters: `created_at_i>${since}`,
          }).toString()}`;

          const response = await fetchJson(
            { source: SOURCE, url, headers: { "user-agent": "intentowl/0.1" } },
            searchResponse,
          );

          for (const entry of response.hits) {
            const item = toRawItem(entry);
            if (item === null || seen.has(item.externalId)) continue;
            seen.add(item.externalId);
            items.push(item);
            if (entry.created_at_i > newest) newest = entry.created_at_i;
          }

          // A short page means this term is drained for this window.
          if (response.hits.length < HITS_PER_PAGE) break;
          if (page === MAX_PAGES_PER_TERM - 1) saturated.push(term);
        }
      }

      const nextCursor: Cursor = { kind: "hn", newestCreatedAt: newest };
      return {
        items,
        nextCursor,
        cost: { calls },
        // A term still full after every page is too broad to cover in one
        // window: the cursor advances past items we never fetched. Surfaced so
        // it can be narrowed rather than silently losing leads.
        ...(saturated.length > 0 ? { warnings: [saturatedWarning(saturated)] } : {}),
      };
    },
  };
}

type Hit = z.infer<typeof hit>;

function toRawItem(entry: Hit): RawItem | null {
  const title = entry.title ?? entry.story_title ?? null;
  const body = entry.story_text ?? entry.comment_text ?? null;

  // A hit with neither a title nor text carries nothing to classify.
  if (title === null && body === null) return null;

  return {
    source: SOURCE,
    externalId: entry.objectID,
    // Always link to the HN thread, not the outbound article: the conversation
    // is where a reply can actually be posted.
    url: `https://news.ycombinator.com/item?id=${entry.objectID}`,
    author: entry.author ?? null,
    title,
    body,
    venue: "news.ycombinator.com",
    postedAt: new Date(entry.created_at_i * 1000),
    engagement: {
      points: entry.points ?? null,
      comments: entry.num_comments ?? null,
      externalUrl: entry.url ?? entry.story_url ?? null,
    },
  };
}

function saturatedWarning(terms: readonly string[]): string {
  return (
    `HN terms returned a full page on every request and may have skipped ` +
    `older matches this window: ${terms.join(", ")}. Narrow them or poll more often.`
  );
}
