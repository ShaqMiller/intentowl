/**
 * Lobsters adapter (lobste.rs).
 *
 * Small, invite-only, and unusually high signal for developer tooling — a
 * fraction of HN's volume with a much better ratio. Free, no auth, and every
 * page serves JSON by appending `.json`.
 *
 * The constraint that shapes this adapter: **Lobsters has no search API.**
 * `search.json` returns 400. So there is no way to ask it a question; we walk
 * `newest.json` back to the cursor and let the pre-filter narrow. That makes it
 * the first source where the filter is doing the real work rather than the
 * provider, which is fine — the filter is free and the volume is tiny.
 */
import { z } from "zod";

import { fetchJson } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import {
  cursorFor,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "lobsters" as const;
const ORIGIN = "https://lobste.rs";

/** Stories per page, fixed by the site. */
const PAGE_SIZE = 25;

/** Pages to walk back before giving up. 75 stories covers a long outage. */
const MAX_PAGES = 3;

/** First run has no cursor; a week back is plenty at this volume. */
const COLD_START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const story = z.object({
  short_id: z.string().min(1),
  short_id_url: z.string(),
  created_at: z.string(),
  title: z.string(),
  url: z.string().nullish(),
  score: z.number().nullish(),
  comment_count: z.number().nullish(),
  description_plain: z.string().nullish(),
  description: z.string().nullish(),
  submitter_user: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  comments_url: z.string().nullish(),
});

const newestResponse = z.array(story);

/**
 * Politeness rather than a published ceiling: Lobsters has no documented rate
 * limit and is run by volunteers on donated hardware. Three pages every ten
 * minutes is nothing.
 */
export const lobstersBucket = new TokenBucket({
  capacity: 5,
  refillPerSecond: 10 / 60,
});

export interface LobstersAdapterOptions {
  bucket?: TokenBucket;
  /** Sent on every request; Lobsters asks that it identify the client. */
  userAgent?: string;
}

export function createLobstersAdapter(
  options: LobstersAdapterOptions = {},
): SourceAdapter {
  const bucket = options.bucket ?? lobstersBucket;
  const userAgent = options.userAgent ?? "intentowl/0.1 (+https://intentowl.com)";

  return {
    source: SOURCE,

    async fetchNew(
      _watch: WatchConfig,
      previous: Cursor | null,
    ): Promise<FetchResult> {
      const previousCursor = cursorFor("lobsters", previous);
      const since =
        previousCursor?.newestCreatedAt ?? Date.now() - COLD_START_LOOKBACK_MS;

      const items: RawItem[] = [];
      const seen = new Set<string>();
      let newest = since;
      let calls = 0;
      let reachedCursor = false;

      for (let page = 1; page <= MAX_PAGES && !reachedCursor; page += 1) {
        await bucket.take();
        calls += 1;

        const stories = await fetchJson(
          {
            source: SOURCE,
            url: `${ORIGIN}/newest.json?page=${page}`,
            headers: { "user-agent": userAgent },
          },
          newestResponse,
        );

        if (stories.length === 0) break;

        for (const entry of stories) {
          const postedAt = new Date(entry.created_at);
          const time = postedAt.getTime();
          if (!Number.isFinite(time)) continue;

          // The list is newest-first, so the first story at or below the cursor
          // means everything after it has been seen. Stop rather than paging on.
          if (time <= since) {
            reachedCursor = true;
            break;
          }

          if (seen.has(entry.short_id)) continue;
          seen.add(entry.short_id);
          if (time > newest) newest = time;
          items.push(toRawItem(entry, postedAt));
        }

        // A short page is the end of the list.
        if (stories.length < PAGE_SIZE) break;
      }

      const nextCursor: Cursor = { kind: "lobsters", newestCreatedAt: newest };
      return {
        items,
        nextCursor,
        cost: { calls },
        // Walking the full page budget without reaching the cursor means the
        // window was wider than we can see. Say so rather than advancing past
        // stories that were never fetched.
        ...(!reachedCursor && items.length >= PAGE_SIZE * MAX_PAGES
          ? {
              warnings: [
                `Lobsters returned ${MAX_PAGES} full pages without reaching the last cursor; poll more often or accept a gap.`,
              ],
            }
          : {}),
      };
    },
  };
}

type Story = z.infer<typeof story>;

function toRawItem(entry: Story, postedAt: Date): RawItem {
  const body = entry.description_plain ?? stripHtml(entry.description ?? "");
  return {
    source: SOURCE,
    externalId: entry.short_id,
    // Always the comments page, never the outbound article: the conversation
    // is where a reply can actually be posted.
    url: entry.comments_url ?? entry.short_id_url,
    author: entry.submitter_user ?? null,
    title: entry.title,
    body: body === "" ? null : body,
    // Tags are Lobsters' equivalent of a subreddit, and the closest thing it
    // has to a venue worth weighting.
    venue:
      entry.tags && entry.tags.length > 0
        ? `lobste.rs/t/${entry.tags[0]}`
        : "lobste.rs",
    postedAt,
    engagement: {
      score: entry.score ?? null,
      comments: entry.comment_count ?? null,
      tags: entry.tags ?? [],
      externalUrl: entry.url ?? null,
    },
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
