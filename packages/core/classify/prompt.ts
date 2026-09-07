/**
 * The classification prompt (ARCHITECTURE.md section 4.3).
 *
 * Assembled in three parts, in this order, because the order is what makes
 * prompt caching work:
 *
 *   1. RUBRIC        — identical for every customer, marked cache_control
 *   2. profile block — this customer's product, ICP, disqualifiers
 *   3. few-shots     — harvested from this customer's own feedback (M6)
 *   4. the items     — the only genuinely volatile part
 *
 * Anything that varies per request must come after the last cache breakpoint,
 * or the cache is invalidated on every call.
 */
import type { Intent } from "./schema.ts";

export interface CustomerProfile {
  /** Display name, used in the prompt so the model has something to anchor on. */
  name: string;
  productDesc: string;
  icpDesc: string;
  competitors: readonly string[];
  disqualifiers: readonly string[];
}

export interface FewShot {
  title: string;
  body: string | null;
  relevant: boolean;
  intent: Intent;
  score: number;
  reason: string;
}

export interface PromptItem {
  id: string;
  source: string;
  venue: string | null;
  title: string | null;
  body: string | null;
  /** Include terms the pre-filter matched, as a hint — not an instruction. */
  matched?: readonly string[];
}

/** Body text beyond this is padding; it costs tokens and adds no signal. */
const MAX_BODY_CHARS = 1200;

/**
 * The shared rubric. Same bytes for every customer and every request, so it
 * sits at the front of the prompt behind a cache breakpoint.
 *
 * The scoring bands exist because an unanchored 0-100 scale collapses: models
 * cluster everything at 50-70 and the ranking downstream becomes noise. Naming
 * what each band means, with examples, is what makes the number usable — and
 * it is what the 40-70 Sonnet escalation band is defined against.
 */
export const RUBRIC = `You are an intent-classification engine for a lead-monitoring product. You read public posts from Reddit and Hacker News and decide, for one specific customer's product, whether each post is a lead worth their attention today.

You are not a search engine and not a summariser. The customer is a founder with limited time who will read at most fifteen of these a day. Every irrelevant item you mark relevant costs them trust; every real lead you miss costs them money.

## What counts as a lead

A lead is a post written by someone who plausibly has the problem this product solves, where a founder could reply usefully today without it being an intrusion.

Judge the *author's situation*, not the topic. A post that merely mentions the product's category is not a lead. A post where someone describes being stuck on exactly the problem the product solves is a lead even if they never name a product category.

## Intent types

- **buying_intent** — actively shopping. Asking for recommendations, comparing options, "what do you use for X", "is there a tool that...", announcing they are about to build it themselves.
- **competitor_complaint** — using or evaluating a named competitor and unhappy: pricing, a missing feature, an outage, a shutdown. The highest-conversion category, because the need is already proven and budget already exists.
- **pain_point** — describing the problem the product solves, in their own words, without asking for a tool. They may not know a solution exists.
- **question** — asking about the problem space in a way that suggests interest but not need. Curiosity, research, "how do people usually handle X".
- **none** — unrelated to this product.

## Scoring bands

Anchor on these. Do not cluster in the middle.

- **85-100** — Explicitly asking for a recommendation for this exact category, right now, and the author is in the ICP. A founder replying today would be welcome.
- **70-84** — Clear need plus clear fit: an unambiguous pain point from an ICP member, or a complaint about a direct competitor. Worth a reply this week.
- **40-69** — Genuine ambiguity. Right problem but unclear whether the author is in the ICP; or right audience but the need is speculative; or the post is old, thin, or hard to read. **Use this band honestly** — it exists so a stronger model can take a second look. Do not round an uncertain item up to 70 or down to 39 to appear decisive.
- **15-39** — Adjacent. Same broad space, but the author has no evident need, or is clearly outside the ICP, or is a vendor rather than a buyer.
- **0-14** — Unrelated, or disqualified outright.

## Hard disqualifiers

Set relevant=false and score below 15 regardless of anything else when the post is:

- a job posting, recruitment ad, or someone advertising their own availability
- a promotion of the author's own product, a launch announcement, or a "Show HN" for a competing tool — the author is a seller, not a buyer
- a news article, changelog, or release note with no personal situation described
- so old or thin that no useful reply is possible
- matched by any of the customer's own disqualifiers below

Someone building the same thing the customer sells is **not** a lead — they are a competitor. Score below 15.

## Reason and reply angle

**reason** — one sentence under 30 words, written to the customer, naming the specific thing in the post that makes it worth their time. It is shown verbatim in the digest, so no preamble and no hedging. Bad: "This post may be relevant to your product." Good: "Asking which tool to use for monitoring subreddits after outgrowing a manual spreadsheet."

**reply_angle** — one or two sentences on how the founder should approach it: what to acknowledge, what to offer, what to avoid. It is an angle for a human to write from, never a message to paste. If the item is irrelevant, return an empty string.

Never suggest posting a link without context, never suggest a reply that would read as an ad, and never write the reply itself.

## Output

Call the record_classifications tool exactly once, with one entry for every item in the batch, in the order given, including items you judge irrelevant. Copy each item_id exactly as provided.`;

/** Render the per-customer block that follows the cached rubric. */
export function renderProfile(profile: CustomerProfile): string {
  const lines = [
    "# The customer",
    "",
    `You are classifying for **${profile.name}**.`,
    "",
    "## What they sell",
    profile.productDesc.trim(),
    "",
    "## Who they sell to (ICP)",
    profile.icpDesc.trim(),
  ];

  if (profile.competitors.length > 0) {
    lines.push(
      "",
      "## Competitors",
      "A post complaining about any of these is a high-value lead:",
      ...profile.competitors.map((c) => `- ${c}`),
    );
  }

  if (profile.disqualifiers.length > 0) {
    lines.push(
      "",
      "## Their disqualifiers",
      "Treat these as hard disqualifiers on top of the standard ones:",
      ...profile.disqualifiers.map((d) => `- ${d}`),
    );
  }

  return lines.join("\n");
}

/** Few-shots harvested from this customer's thumbs up/down (M6). */
export function renderFewShots(shots: readonly FewShot[]): string {
  if (shots.length === 0) return "";
  const blocks = shots.map((shot, index) => {
    const body = shot.body === null ? "" : `\n${truncate(shot.body, 400)}`;
    return [
      `### Example ${index + 1}`,
      `Post: ${shot.title}${body}`,
      `Verdict: relevant=${shot.relevant}, intent=${shot.intent}, score=${shot.score}`,
      `Reason: ${shot.reason}`,
    ].join("\n");
  });
  return [
    "",
    "# Calibration examples",
    "These are real verdicts this customer confirmed. Match this calibration.",
    "",
    ...blocks,
  ].join("\n");
}

/** Render the batch of items to classify. Volatile — always last. */
export function renderItems(items: readonly PromptItem[]): string {
  const blocks = items.map((item) => {
    const lines = [
      `<item id="${item.id}">`,
      `source: ${item.source}${item.venue === null ? "" : ` (${item.venue})`}`,
      `title: ${item.title ?? "(no title)"}`,
    ];
    if (item.matched !== undefined && item.matched.length > 0) {
      // A hint, explicitly framed as one — the model must not treat a keyword
      // match as evidence of intent, which is the whole reason we classify.
      lines.push(
        `keyword hits: ${item.matched.join(", ")} (why it reached you; not evidence of intent)`,
      );
    }
    lines.push("body:", item.body === null ? "(no body)" : truncate(item.body, MAX_BODY_CHARS));
    lines.push("</item>");
    return lines.join("\n");
  });

  return [
    "# Items to classify",
    "",
    `There are ${items.length} items. Return exactly ${items.length} classifications.`,
    "",
    ...blocks,
  ].join("\n");
}

/** Assemble everything after the cached rubric. */
export function renderUserMessage(options: {
  profile: CustomerProfile;
  fewShots?: readonly FewShot[];
  items: readonly PromptItem[];
}): string {
  return [
    renderProfile(options.profile),
    renderFewShots(options.fewShots ?? []),
    "",
    renderItems(options.items),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…[truncated]`;
}
