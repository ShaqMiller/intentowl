/**
 * Onboarding draft: a founder's few sentences → a starting profile and search.
 *
 * The profile is the biggest lever on lead quality and the part new customers
 * are worst at writing: they describe features, not the situation a post
 * would describe, and they pick search terms from their marketing copy rather
 * than from how a person with the problem actually writes. So Claude drafts
 * both from the founder's own words, and the founder edits before anything
 * runs. Nothing here is saved; the web action saves what the founder approves.
 *
 * One forced tool call, Zod-validated — the same shape as the classifier.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { estimateCostUsd, SONNET_MODEL, type ClassifyUsage } from "../classify/classifier.ts";

export const DRAFT_TOOL_NAME = "record_setup";

const list = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

const DRAFT_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "productDesc",
    "icpDesc",
    "competitors",
    "disqualifiers",
    "includeTerms",
    "excludeTerms",
    "searchName",
  ],
  properties: {
    productDesc: { type: "string", description: "2-4 plain sentences on what the product does and what people do instead." },
    icpDesc: { type: "string", description: "1-3 sentences on who buys: role, company stage and size, how technical." },
    competitors: list("Named competing products, at most 8."),
    disqualifiers: list("3-6 short phrases describing posts that look relevant but are not customers."),
    includeTerms: list("15-25 lowercase search terms, 1-3 words, in the words of someone with the problem."),
    excludeTerms: list("3-8 lowercase terms that mark noise for this product."),
    searchName: { type: "string", description: "2-5 words naming who this search finds." },
  },
} as const;

const draftSchema = z.object({
  productDesc: z.string().trim().min(1).max(2000),
  icpDesc: z.string().trim().min(1).max(2000),
  competitors: z.array(z.string()),
  disqualifiers: z.array(z.string()),
  includeTerms: z.array(z.string()),
  excludeTerms: z.array(z.string()),
  searchName: z.string().trim().min(1).max(80),
});

export interface OnboardingInput {
  /** The founder's own description of what they sell. Required. */
  description: string;
  /** Who they think buys it, if they said. */
  audience?: string;
  /** Competitors they named, free text. */
  competitors?: string;
}

export interface OnboardingDraft {
  productDesc: string;
  icpDesc: string;
  competitors: string[];
  disqualifiers: string[];
  includeTerms: string[];
  excludeTerms: string[];
  searchName: string;
}

export interface DraftResult {
  draft: OnboardingDraft;
  usage: ClassifyUsage;
  costUsd: number;
}

export interface DraftOptions {
  client?: Anthropic;
  apiKey?: string;
  workspaceId?: string;
  model?: string;
}

/**
 * The instructions carry IntentOwl's actual matching rules, because terms
 * written without them are the commonest cause of an empty digest: a single
 * common word matches everything, and a long exact phrase matches nothing.
 */
export const DRAFT_SYSTEM = `You set up IntentOwl for a new customer.

IntentOwl reads public posts on Hacker News, Bluesky, Lobsters and Stack Exchange, and emails a founder each morning the posts where someone describes the problem the founder's product solves. A cheap keyword filter runs first; an AI classifier then judges each surviving post against the customer's profile.

From the founder's own words, draft their profile and a first search by calling ${DRAFT_TOOL_NAME}.

productDesc — 2 to 4 plain sentences, written the way you would explain the product to a peer, not a pricing page. Include what people do instead of using it: that is the situation a useful post describes. Never invent features, prices, integrations or claims that are not in the founder's text.

icpDesc — 1 to 3 sentences on who buys: their role, company stage and size, and how technical they are. If the founder did not say, infer cautiously from the product and say "likely".

competitors — products the founder named, plus well-known direct alternatives only when you are confident they exist and compete. At most 8. Leave it empty rather than guess.

disqualifiers — 3 to 6 short phrases for posts that look relevant but are not customers: people selling a competing tool, job posts, students, and agencies or freelancers when the product is for companies (or the reverse).

includeTerms — 15 to 25 lowercase terms of 1 to 3 words, in the words a person with the problem would actually write in a post, not marketing language. Mix problem phrases, situation phrases and competitor names. How matching works:
- a single word matches if it appears anywhere, so never use a common single word such as "marketing", "users", "data" or "app";
- an unquoted multi-word term matches when all its words appear near each other, in any order — this is the default and usually right;
- wrap a term in double quotes only for an exact phrase whose words are too common on their own, e.g. "market my".

excludeTerms — 3 to 8 lowercase terms that mark noise for this product, e.g. "who is hiring", "for hire", "giveaway".

searchName — 2 to 5 words naming who the search finds, e.g. "Founders chasing late invoices".`;

export function renderDraftInput(input: OnboardingInput): string {
  const parts = [`What the founder sells, in their words:\n${input.description.trim()}`];
  if (input.audience !== undefined && input.audience.trim() !== "") {
    parts.push(`Who they say buys it:\n${input.audience.trim()}`);
  }
  if (input.competitors !== undefined && input.competitors.trim() !== "") {
    parts.push(`Competitors they named:\n${input.competitors.trim()}`);
  }
  return parts.join("\n\n");
}

export async function draftOnboarding(
  input: OnboardingInput,
  options: DraftOptions = {},
): Promise<DraftResult> {
  const client =
    options.client ??
    new Anthropic({
      // A founder is waiting on this page; fail fast and let them fill it in.
      timeout: 60_000,
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.workspaceId === undefined
        ? {}
        : { defaultHeaders: { "anthropic-workspace-id": options.workspaceId } }),
    });
  const model = options.model ?? SONNET_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: 2_000,
    // Drafting is a writing task the instructions already scaffold.
    thinking: { type: "disabled" },
    system: DRAFT_SYSTEM,
    tools: [
      {
        name: DRAFT_TOOL_NAME,
        description: "Record the drafted profile and first search.",
        input_schema: DRAFT_TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: DRAFT_TOOL_NAME },
    messages: [{ role: "user", content: renderDraftInput(input) }],
  });

  const tool = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === DRAFT_TOOL_NAME,
  );
  if (tool === undefined) {
    throw new Error(`${model} returned no ${DRAFT_TOOL_NAME} call (stop_reason=${response.stop_reason})`);
  }

  const parsed = draftSchema.safeParse(tool.input);
  if (!parsed.success) {
    throw new Error(`${model} returned an invalid draft: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  const usage: ClassifyUsage = {
    model,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };

  return { draft: tidyDraft(parsed.data), usage, costUsd: estimateCostUsd([usage]) };
}

/**
 * Trim, drop empties, dedupe case-insensitively and cap each list. The model
 * is asked for these limits; this makes them true.
 */
export function tidyDraft(draft: OnboardingDraft): OnboardingDraft {
  const clean = (values: readonly string[], max: number, lower = false): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const value = lower ? raw.trim().toLowerCase() : raw.trim();
      if (value === "" || seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      out.push(value);
      if (out.length >= max) break;
    }
    return out;
  };

  return {
    productDesc: draft.productDesc.trim(),
    icpDesc: draft.icpDesc.trim(),
    competitors: clean(draft.competitors, 8),
    disqualifiers: clean(draft.disqualifiers, 8),
    includeTerms: clean(draft.includeTerms, 25, true),
    excludeTerms: clean(draft.excludeTerms, 10, true),
    searchName: draft.searchName.trim().slice(0, 80),
  };
}
