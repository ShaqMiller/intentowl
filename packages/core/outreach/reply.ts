/**
 * Draft a reply to one lead.
 *
 * The digest already says why a post matters and suggests an angle. This goes
 * one step further and writes the reply itself, because the gap between "good
 * lead" and "replied to it" is usually a blank text box at 7am.
 *
 * What it will not do: post anything. IntentOwl promises on every page that it
 * never posts on a customer's behalf, and this keeps that promise — it returns
 * text for a person to read, edit and send themselves.
 *
 * The rules in the prompt are the ones that keep a founder welcome in a
 * community: answer the question first, disclose who you are, mention the
 * product once and last, and never pretend to be a neutral bystander.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { estimateCostUsd, HAIKU_MODEL, type ClassifyUsage } from "../classify/classifier.ts";

export const REPLY_TOOL_NAME = "record_reply";

const REPLY_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "opening", "risk"],
  properties: {
    reply: {
      type: "string",
      description:
        "The whole reply, ready to paste. 60-110 words, plain sentences, no emoji, no markdown headings.",
    },
    opening: {
      type: "string",
      description: "The first sentence on its own, so the founder can judge the tone at a glance.",
    },
    risk: {
      type: "string",
      description:
        "One short sentence naming the biggest reason this reply could land badly, or 'none' if there is none.",
    },
  },
} as const;

const replySchema = z.object({
  reply: z.string().trim().min(1).max(3000),
  opening: z.string().trim().min(1).max(500),
  risk: z.string().trim().min(1).max(500),
});

export type DraftedReply = z.infer<typeof replySchema>;

export interface ReplyLead {
  title: string | null;
  body: string | null;
  url: string;
  venue: string | null;
  author: string | null;
  source: string;
  score: number;
  /** The classifier's note on why this post matters to this customer. */
  reason: string | null;
  /** The angle the digest already suggested, if any. */
  replyAngle: string | null;
}

export interface ReplyContext {
  productName: string;
  productDesc: string;
  icpDesc: string;
  /** The offer to mention once, at the end. */
  trialLine: string;
  /** Where to send anyone who asks. */
  url: string;
}

export const REPLY_SYSTEM = `You write replies a founder posts under their own name, in public communities.

The founder built the product. They are not a neutral bystander and must not sound like one.

Rules, in order of importance:
1. Answer the person first. Give them something useful even if they never click anything — how you would approach their problem, what you would check, what usually causes it.
2. Sound like one person typing, not marketing. Short sentences. No slogans, no "game-changer", no emoji, no bullet lists unless the question is genuinely a list.
3. Disclose plainly. "I build X" or "I make a tool for this" — once, near the end, never in the first sentence.
4. Mention the product last, in one sentence, with the trial offer exactly as given. Never repeat the offer.
5. Match the room. A one-line question gets a short reply. A detailed post gets a fuller one.
6. Never claim to have used a competitor you were not told about, never invent numbers, never promise features.
7. If replying at all would be unwelcome — the post is old news, a rant with no question, or clearly not about this problem — say so in "risk" and still write the most restrained reply you can.

Write British-neutral plain English. No headings. No sign-off.`;

export function renderReplyInput(lead: ReplyLead, context: ReplyContext): string {
  const parts = [
    `PRODUCT: ${context.productName}`,
    `WHAT IT DOES: ${context.productDesc}`,
    `WHO IT IS FOR: ${context.icpDesc}`,
    `OFFER TO MENTION ONCE: ${context.trialLine}`,
    `LINK: ${context.url}`,
    "",
    `POST FROM: ${lead.author ?? "someone"} on ${lead.venue ?? lead.source}`,
    `TITLE: ${lead.title ?? "(no title)"}`,
    `BODY: ${(lead.body ?? "").slice(0, 1500) || "(no body)"}`,
  ];
  if (lead.reason !== null) parts.push(`WHY IT MATTERS: ${lead.reason}`);
  if (lead.replyAngle !== null) parts.push(`SUGGESTED ANGLE: ${lead.replyAngle}`);
  return parts.join("\n");
}

export interface ReplyOptions {
  apiKey: string;
  workspaceId?: string;
  model?: string;
  client?: Anthropic;
}

export interface ReplyResult {
  draft: DraftedReply;
  usage: ClassifyUsage;
  costUsd: number;
}

export async function draftReply(
  lead: ReplyLead,
  context: ReplyContext,
  options: ReplyOptions,
): Promise<ReplyResult> {
  const model = options.model ?? HAIKU_MODEL;
  const client =
    options.client ??
    new Anthropic({
      apiKey: options.apiKey,
      ...(options.workspaceId === undefined
        ? {}
        : { defaultHeaders: { "anthropic-workspace-id": options.workspaceId } }),
    });

  const response = await client.messages.create({
    model,
    max_tokens: 900,
    system: REPLY_SYSTEM,
    tools: [
      {
        name: REPLY_TOOL_NAME,
        description: "Record the drafted reply.",
        input_schema: REPLY_TOOL_SCHEMA as never,
      },
    ],
    tool_choice: { type: "tool", name: REPLY_TOOL_NAME },
    messages: [{ role: "user", content: renderReplyInput(lead, context) }],
  });

  const block = response.content.find((part) => part.type === "tool_use");
  if (block === undefined || block.type !== "tool_use") {
    throw new Error("the model returned no reply");
  }

  const usage: ClassifyUsage = {
    model,
    tokensIn: response.usage.input_tokens,
    tokensOut: response.usage.output_tokens,
    // No cached prefix on a one-off call; reported so the cost table adds up.
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };

  return {
    draft: replySchema.parse(block.input),
    usage,
    costUsd: estimateCostUsd([usage]),
  };
}
