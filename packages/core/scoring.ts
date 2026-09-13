/**
 * Scoring and ranking (ARCHITECTURE.md section 4.4).
 *
 * The classifier's 0-100 is a judgement about the *post*. Ranking is a
 * judgement about *this morning's inbox*, which is a different question: a
 * perfect lead from four days ago is worth less than a good one from an hour
 * ago, because the thread has moved on and a late reply reads as spam.
 *
 * Every function here is pure. The clock is passed in rather than read, so the
 * whole ranking is deterministic and testable — which matters because ranking
 * bugs are invisible: the digest still arrives, it is just subtly worse.
 */

export interface ScorableLead {
  itemId: string;
  /** The classifier's verdict, 0-100. */
  score: number;
  relevant: boolean;
  intent: string;
  title: string | null;
  body: string | null;
  url: string;
  venue: string | null;
  author: string | null;
  postedAt: Date | null;
  reason: string | null;
  replyAngle: string | null;
  /** Whatever the source gave us: upvotes, comments, points. */
  engagement: Record<string, unknown> | null;
}

export interface RankedLead extends ScorableLead {
  /** Final rank score. Not comparable across days — only within one digest. */
  rank: number;
  /** Multiplier breakdown, so a surprising ordering can be explained. */
  factors: {
    base: number;
    recency: number;
    venue: number;
    engagement: number;
  };
  /** Other postings of the same lead, collapsed into this one. */
  duplicates: { url: string; venue: string | null }[];
}

export interface RankOptions {
  now: Date;
  /** Per-venue multipliers; 1 when unlisted. */
  venueWeights?: Readonly<Record<string, number>>;
  /** Hours for recency weight to halve. */
  halfLifeHours?: number;
  /** Drop anything below this before ranking. */
  minScore?: number;
}

const DEFAULT_HALF_LIFE_HOURS = 24;
const DEFAULT_MIN_SCORE = 40;

/**
 * Exponential decay on age, halving every `halfLifeHours`.
 *
 * Floored at 0.15 rather than approaching zero: an outstanding week-old lead
 * should slide down the digest, not vanish from it. Undated items are treated
 * as fresh — penalising a missing timestamp would silently bury whole sources
 * whose adapters do not supply one.
 */
export function recencyWeight(
  postedAt: Date | null,
  now: Date,
  halfLifeHours = DEFAULT_HALF_LIFE_HOURS,
): number {
  if (postedAt === null) return 1;
  const ageHours = (now.getTime() - postedAt.getTime()) / 3_600_000;
  if (ageHours <= 0) return 1;
  return Math.max(0.15, Math.pow(0.5, ageHours / halfLifeHours));
}

/**
 * Engagement as a gentle multiplier, not a driver.
 *
 * A busy thread is a warmer lead, but popularity is not intent — the front
 * page of HN is enormously engaged and almost never a lead. Logarithmic and
 * clamped to 0.9-1.25 so it can nudge ordering without ever overturning the
 * classifier's judgement.
 */
export function engagementWeight(
  engagement: Record<string, unknown> | null,
): number {
  if (engagement === null) return 1;
  const num = (key: string): number => {
    const value = engagement[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const comments = num("comments");
  const score = num("score") + num("points");
  // Comments weigh more than upvotes: a reply is a conversation to join.
  const signal = comments * 2 + score;
  if (signal <= 0) return 0.9;
  return Math.min(1.25, 0.9 + Math.log10(1 + signal) * 0.12);
}

export function venueWeight(
  venue: string | null,
  weights: Readonly<Record<string, number>> | undefined,
): number {
  if (venue === null || weights === undefined) return 1;
  return weights[venue] ?? weights[venue.toLowerCase()] ?? 1;
}

/**
 * A normalised key for spotting the same lead posted in several places.
 *
 * Same author plus a similar title is the real-world case: a founder
 * cross-posting one question to three subreddits, usually tweaking the tail of
 * the title for each ("...for my niche" / "...for my startup"). Keyed on the
 * first five meaningful words, which survives that edit; the author match is
 * what keeps it from over-collapsing two people asking the same question.
 */
export function duplicateKey(lead: ScorableLead): string {
  const words = (lead.title ?? lead.body ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(" ");
  return `${lead.author ?? "anon"}::${words}`;
}

/**
 * Collapse near-duplicates, keeping the highest-scoring copy and attaching the
 * rest as extra links. Three subreddits is one lead with three links, not
 * three leads — showing it three times is the fastest way to look broken.
 */
export function collapseDuplicates(leads: readonly ScorableLead[]): {
  lead: ScorableLead;
  duplicates: { url: string; venue: string | null }[];
}[] {
  const groups = new Map<string, ScorableLead[]>();
  for (const lead of leads) {
    const key = duplicateKey(lead);
    const group = groups.get(key) ?? [];
    group.push(lead);
    groups.set(key, group);
  }

  const out: { lead: ScorableLead; duplicates: { url: string; venue: string | null }[] }[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => b.score - a.score);
    const best = sorted[0];
    if (best === undefined) continue;
    out.push({
      lead: best,
      duplicates: sorted.slice(1).map((d) => ({ url: d.url, venue: d.venue })),
    });
  }
  return out;
}

/** Rank a customer's leads for one digest. Highest first. */
export function rankLeads(
  leads: readonly ScorableLead[],
  options: RankOptions,
): RankedLead[] {
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const halfLife = options.halfLifeHours ?? DEFAULT_HALF_LIFE_HOURS;

  const eligible = leads.filter(
    (lead) => lead.relevant && lead.score >= minScore,
  );

  return collapseDuplicates(eligible)
    .map(({ lead, duplicates }) => {
      const factors = {
        base: lead.score,
        recency: recencyWeight(lead.postedAt, options.now, halfLife),
        venue: venueWeight(lead.venue, options.venueWeights),
        engagement: engagementWeight(lead.engagement),
      };
      return {
        ...lead,
        duplicates,
        factors,
        rank: factors.base * factors.recency * factors.venue * factors.engagement,
      };
    })
    .sort((a, b) => b.rank - a.rank || a.itemId.localeCompare(b.itemId));
}

/** Intent groups, in the order a founder should read them. */
export const INTENT_ORDER = [
  "buying_intent",
  "competitor_complaint",
  "pain_point",
  "question",
  "none",
] as const;

export const INTENT_LABELS: Record<string, string> = {
  buying_intent: "Buying intent",
  competitor_complaint: "Competitor complaints",
  pain_point: "Pain points",
  question: "Questions",
  none: "Other",
};

export interface DigestGroup {
  intent: string;
  label: string;
  leads: RankedLead[];
}

/**
 * Group ranked leads for display, best group first.
 *
 * Competitor complaints sit second because the need is already proven and the
 * budget already exists — the highest-conversion category after someone
 * explicitly shopping.
 */
export function groupForDigest(
  ranked: readonly RankedLead[],
  limit = 15,
): DigestGroup[] {
  const top = ranked.slice(0, limit);
  const groups: DigestGroup[] = [];
  for (const intent of INTENT_ORDER) {
    const leads = top.filter((lead) => lead.intent === intent);
    if (leads.length === 0) continue;
    groups.push({ intent, label: INTENT_LABELS[intent] ?? intent, leads });
  }
  return groups;
}

/**
 * The line a lead is shown under, in the email, the Slack message and the
 * inbox preview.
 *
 * Bluesky posts have no title — the adapter deliberately stores `title: null`
 * rather than duplicating the text — so every renderer that reached for
 * `lead.title` fell back to a placeholder. On 13 September six of seven leads
 * in the digest were Bluesky posts, and the email showed "(untitled post)" six
 * times with an inbox preview reading "7 leads — " followed by nothing. That
 * looks like spam, and plausibly got treated as spam.
 *
 * Falls back to the opening of the post itself, cut at a sentence or word
 * boundary so it reads as a line rather than a truncated blob.
 */
export function leadHeadline(
  lead: Pick<ScorableLead, "title" | "body">,
  max = 110,
): string {
  const title = lead.title?.trim();
  if (title !== undefined && title !== "") return title;

  const body = (lead.body ?? "").replace(/\s+/g, " ").trim();
  if (body === "") return "Untitled post";

  // Prefer the first sentence when it fits — it is usually the actual ask.
  const sentence = /^(.+?[.?!])(\s|$)/.exec(body)?.[1];
  if (sentence !== undefined && sentence.length <= max) return sentence;

  if (body.length <= max) return body;
  const cut = body.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
