/**
 * GitHub issues adapter.
 *
 * The best "leaving a competitor" surface there is for developer tools. People
 * write the switch down in public, in the repo of the thing they are leaving:
 * "we moved off X because the export is unusable". Every hit carries a URL the
 * founder can reply at, and the author is a real account rather than a handle
 * with no context.
 *
 * Scope is issues only. Discussions live behind GraphQL and are a separate
 * adapter; pull requests are excluded because a PR is work, not a complaint.
 *
 * Two provider rules this adapter must respect:
 *   - Search is rate limited apart from the rest of the API: 30 requests per
 *     minute with a token, 10 without. That is per account, shared across
 *     every customer, so the poll budget is deliberately small.
 *   - GitHub's acceptable use policy allows collecting this through the API
 *     but forbids using what you collect to send unsolicited email. The digest
 *     goes to the customer, never to the issue's author, and nothing here
 *     collects an address.
 */
import { z } from "zod";

import { AdapterError, fetchJson } from "./http.ts";
import { TokenBucket } from "./rate-limit.ts";
import {
  cursorFor,
  skippedTermsWarning,
  type Cursor,
  type FetchResult,
  type RawItem,
  type SourceAdapter,
  type WatchConfig,
} from "./types.ts";

const SOURCE = "github" as const;
const API = "https://api.github.com/search/issues";

/**
 * Terms searched per poll, one request each.
 *
 * Search allows 30 requests/minute authenticated and 10 unauthenticated, and
 * that ceiling is shared by every watch. Ten terms a poll leaves room for the
 * other customers polling in the same minute.
 */
const MAX_TERMS_WITH_TOKEN = 10;
const MAX_TERMS_ANONYMOUS = 3;

const PAGE_SIZE = 50;

/**
 * First run has no cursor. Fourteen days rather than HN's seven: an issue
 * thread stays live for weeks, so a fortnight-old complaint is still worth
 * replying to.
 */
const COLD_START_LOOKBACK_DAYS = 14;

/** Bodies run long. Enough to judge intent, not enough to bloat a prompt. */
const MAX_BODY_CHARS = 4_000;

const issue = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  html_url: z.url(),
  created_at: z.string(),
  state: z.string().nullish(),
  comments: z.number().nullish(),
  repository_url: z.string().nullish(),
  user: z.object({ login: z.string().nullish() }).nullish(),
  labels: z.array(z.object({ name: z.string().nullish() })).nullish(),
  reactions: z.object({ total_count: z.number().nullish() }).nullish(),
  /** Present only on pull requests, which this adapter drops. */
  pull_request: z.unknown().nullish(),
});

const searchResponse = z.object({
  total_count: z.number().nullish(),
  incomplete_results: z.boolean().nullish(),
  items: z.array(issue),
});

/** 30/minute with a token; the bucket is set just under that. */
export const githubBucket = new TokenBucket({
  capacity: 5,
  refillPerSecond: 0.4,
});

export interface GithubAdapterOptions {
  bucket?: TokenBucket;
  /**
   * A fine-grained token with no scopes is enough for public search, and it
   * triples the rate limit. Without one the adapter still works, slower.
   */
  token?: string;
}

export function createGithubAdapter(options: GithubAdapterOptions = {}): SourceAdapter {
  const bucket = options.bucket ?? githubBucket;

  return {
    source: SOURCE,

    async fetchNew(watch: WatchConfig, previous: Cursor | null): Promise<FetchResult> {
      if (watch.includeTerms.length === 0) {
        throw new AdapterError(
          SOURCE,
          `watch ${watch.id} has no include terms; GitHub search needs a query`,
        );
      }

      const previousCursor = cursorFor("github", previous);
      const since =
        previousCursor?.newestCreatedAt ??
        Date.now() - COLD_START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

      const maxTerms = options.token === undefined ? MAX_TERMS_ANONYMOUS : MAX_TERMS_WITH_TOKEN;
      const terms = watch.includeTerms.slice(0, maxTerms);
      const warnings: string[] = [];

      // One cursor covers the whole source, so a term skipped this poll is not
      // delayed — the cursor moves past its window and those issues are never
      // seen. Say so rather than letting it look like a term that never hits.
      if (watch.includeTerms.length > terms.length) {
        warnings.push(
          skippedTermsWarning(watch.includeTerms.slice(terms.length)) +
            (options.token === undefined
              ? ". Set GITHUB_TOKEN to raise the limit from 3 terms to 10."
              : ""),
        );
      }

      const items: RawItem[] = [];
      const seen = new Set<string>();
      let newest = since;
      let calls = 0;

      for (const term of terms) {
        await bucket.take();
        calls += 1;

        const params = new URLSearchParams({
          q: `${quoteTerm(term)} is:issue created:>=${isoSeconds(since)}`,
          sort: "created",
          order: "desc",
          per_page: String(PAGE_SIZE),
          // GitHub's newer search backend; the old one is being retired.
          advanced_search: "true",
        });

        let response;
        try {
          response = await fetchJson(
            {
              source: SOURCE,
              url: `${API}?${params.toString()}`,
              headers: {
                accept: "application/vnd.github+json",
                "x-github-api-version": "2022-11-28",
                "user-agent": "intentowl/0.1",
                ...(options.token === undefined
                  ? {}
                  : { authorization: `Bearer ${options.token}` }),
              },
            },
            searchResponse,
          );
        } catch (error) {
          // GitHub answers a query it cannot parse with 422. That is one bad
          // term, not a broken source, so the rest of the poll continues.
          if (error instanceof AdapterError && /returned 422/.test(error.message)) {
            warnings.push(`GitHub rejected the term "${term}" and skipped it.`);
            continue;
          }
          throw error;
        }

        for (const entry of response.items) {
          // Pull requests come back from the same index. `is:issue` should
          // have excluded them; this is the belt to that braces.
          if (entry.pull_request !== null && entry.pull_request !== undefined) continue;

          const id = String(entry.id);
          if (seen.has(id)) continue;
          seen.add(id);

          const created = Date.parse(entry.created_at);
          if (Number.isNaN(created)) continue;
          if (created > newest) newest = created;
          items.push(toRawItem(entry, created));
        }
      }

      return {
        items,
        nextCursor: { kind: SOURCE, newestCreatedAt: newest },
        cost: { calls },
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },
  };
}

/**
 * Multi-word terms are quoted so GitHub treats them as a phrase.
 *
 * Unquoted, GitHub ORs the words: `find first customers` would return every
 * issue containing "first". The pre-filter still does the flexible matching
 * afterwards — this is only about not dragging the whole index over the wire.
 * A term the customer already quoted is passed through as-is.
 */
export function quoteTerm(term: string): string {
  const trimmed = term.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

/** GitHub's search takes ISO 8601 to the second. */
function isoSeconds(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

type Issue = z.infer<typeof issue>;

function toRawItem(entry: Issue, createdMs: number): RawItem {
  const body = (entry.body ?? "").trim();
  return {
    source: SOURCE,
    externalId: String(entry.id),
    url: entry.html_url,
    author: entry.user?.login ?? null,
    title: entry.title,
    body: body === "" ? null : body.slice(0, MAX_BODY_CHARS),
    // "owner/repo", which is what a reader recognises and what venue
    // weighting keys on.
    venue: repoFromApiUrl(entry.repository_url ?? null),
    postedAt: new Date(createdMs),
    engagement: {
      comments: entry.comments ?? null,
      reactions: entry.reactions?.total_count ?? null,
      state: entry.state ?? null,
      labels: (entry.labels ?? [])
        .map((label) => label.name)
        .filter((name): name is string => typeof name === "string"),
    },
  };
}

/** `https://api.github.com/repos/vercel/next.js` -> `vercel/next.js`. */
export function repoFromApiUrl(apiUrl: string | null): string | null {
  if (apiUrl === null) return null;
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(apiUrl);
  return match?.[1] ?? null;
}
