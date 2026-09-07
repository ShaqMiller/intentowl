/**
 * Golden-set harvester (ARCHITECTURE.md section 4.3).
 *
 * Pulls real posts from HN into a candidate file for hand-labelling. This is
 * deliberately NOT the poll path: polling is incremental and time-ordered
 * (`search_by_date`), whereas building an eval set wants the most on-topic
 * posts of all time, so it uses the relevance-sorted `/search` endpoint.
 *
 * The query list is built to produce a *balanced* set. Half the queries aim at
 * genuine leads; the rest are hard negatives that share the same vocabulary
 * with a different meaning ("enterprise customer wants our source code",
 * "waiting on customer support"). An eval made only of easy negatives measures
 * nothing — the hard negatives are the ones that catch a rubric drifting
 * toward keyword matching.
 *
 *   pnpm --filter @intentowl/core harvest
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEARCH = "https://hn.algolia.com/api/v1/search";

interface Query {
  query: string;
  tags: string;
  /** What this query is expected to surface, to keep the mix honest. */
  aim: "leads" | "hard_negatives" | "noise";
  take: number;
}

const QUERIES: Query[] = [
  // --- aimed at genuine leads -------------------------------------------
  { query: "find first customers", tags: "ask_hn", aim: "leads", take: 10 },
  { query: "get users for my startup", tags: "ask_hn", aim: "leads", take: 8 },
  { query: "how to market my saas", tags: "ask_hn", aim: "leads", take: 8 },
  { query: "marketing solo founder", tags: "ask_hn", aim: "leads", take: 6 },
  { query: "reddit marketing tool", tags: "ask_hn", aim: "leads", take: 5 },
  { query: "monitor mentions brand", tags: "ask_hn", aim: "leads", take: 5 },

  // --- same words, different meaning ------------------------------------
  { query: "customer support", tags: "ask_hn", aim: "hard_negatives", take: 6 },
  { query: "enterprise customer contract", tags: "ask_hn", aim: "hard_negatives", take: 5 },
  { query: "hiring first engineer", tags: "ask_hn", aim: "hard_negatives", take: 5 },
  { query: "launch show hn feedback", tags: "show_hn", aim: "hard_negatives", take: 6 },

  // --- ordinary HN traffic ----------------------------------------------
  { query: "rust performance", tags: "story", aim: "noise", take: 4 },
  { query: "kubernetes", tags: "ask_hn", aim: "noise", take: 4 },
];

interface Hit {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  url?: string | null;
  author?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at_i: number;
}

interface Candidate {
  id: string;
  source: "hn";
  venue: string;
  url: string;
  author: string | null;
  title: string;
  body: string | null;
  points: number | null;
  comments: number | null;
  postedAt: string;
  harvestedFor: Query["aim"];
  harvestQuery: string;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

async function run(): Promise<void> {
  const byId = new Map<string, Candidate>();

  for (const q of QUERIES) {
    const url = `${SEARCH}?${new URLSearchParams({
      query: q.query,
      tags: q.tags,
      hitsPerPage: String(q.take * 3),
    }).toString()}`;

    const response = await fetch(url, {
      headers: { "user-agent": "intentowl-eval-harvest/0.1" },
    });
    if (!response.ok) {
      console.error(`  ! ${q.query}: HTTP ${response.status}`);
      continue;
    }
    const payload = (await response.json()) as { hits: Hit[] };

    let taken = 0;
    for (const hit of payload.hits) {
      if (taken >= q.take) break;
      const title = (hit.title ?? hit.story_title ?? "").trim();
      const body = stripHtml(hit.story_text ?? hit.comment_text ?? "");
      // A post with no title and no text carries nothing to judge.
      if (title === "" || title === "[dead]") continue;
      if (byId.has(hit.objectID)) continue;

      byId.set(hit.objectID, {
        id: hit.objectID,
        source: "hn",
        venue: "news.ycombinator.com",
        url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        author: hit.author ?? null,
        title,
        body: body === "" ? null : body.slice(0, 900),
        points: hit.points ?? null,
        comments: hit.num_comments ?? null,
        postedAt: new Date(hit.created_at_i * 1000).toISOString(),
        harvestedFor: q.aim,
        harvestQuery: q.query,
      });
      taken += 1;
    }
    console.log(`  ${q.aim.padEnd(15)} "${q.query}" -> ${taken}`);
  }

  const candidates = [...byId.values()];
  const out = fileURLToPath(new URL("./candidates.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify(candidates, null, 2)}\n`);

  const counts = candidates.reduce<Record<string, number>>((acc, c) => {
    acc[c.harvestedFor] = (acc[c.harvestedFor] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n${candidates.length} candidates -> ${out}`);
  console.log(`mix: ${JSON.stringify(counts)}`);
}

await run();
