/**
 * The classification contract (ARCHITECTURE.md section 4.3).
 *
 * Two representations of one shape, deliberately kept side by side:
 *
 *   - `classificationSchema` (Zod) validates what the model returned. Nothing
 *     reaches the database without passing it.
 *   - `CLASSIFY_TOOL_SCHEMA` (JSON Schema) is what the model is handed, with
 *     `strict: true`, so arguments are schema-valid before we ever see them.
 *
 * They must stay in sync; `schema.test.ts` asserts that they agree on the
 * enum members and the required fields, so a change to one fails loudly rather
 * than drifting.
 */
import { z } from "zod";

export const INTENTS = [
  "buying_intent",
  "pain_point",
  "competitor_complaint",
  "question",
  "none",
] as const;

export type Intent = (typeof INTENTS)[number];

export const classificationSchema = z.object({
  /** Echoed back so a batch response can be matched to its inputs. */
  item_id: z.string().min(1),
  relevant: z.boolean(),
  intent: z.enum(INTENTS),
  /** 0-100. Ranking happens downstream; this is the model's raw read. */
  score: z.number().int().min(0).max(100),
  /** One sentence, shown verbatim in the digest as "why it matters". */
  reason: z.string().min(1).max(400),
  /** An angle for a human to write from — never a canned reply to paste. */
  reply_angle: z.string().max(600),
});

export type Classification = z.infer<typeof classificationSchema>;

export const classificationBatchSchema = z.object({
  classifications: z.array(classificationSchema),
});

export type ClassificationBatch = z.infer<typeof classificationBatchSchema>;

export const CLASSIFY_TOOL_NAME = "record_classifications";

/**
 * Hand-written rather than generated from the Zod schema: `strict: true`
 * requires `additionalProperties: false` and an exact `required` list at every
 * level, and the descriptions here are load-bearing prompt text the model
 * actually reads.
 */
export const CLASSIFY_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["classifications"],
  properties: {
    classifications: {
      type: "array",
      description:
        "One entry for every item in the batch, in the same order, including items you judge irrelevant.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "relevant", "intent", "score", "reason", "reply_angle"],
        properties: {
          item_id: {
            type: "string",
            description: "The id of the item being classified, copied exactly.",
          },
          relevant: {
            type: "boolean",
            description:
              "True only if a founder of this specific product would want to see this post today.",
          },
          intent: {
            type: "string",
            enum: [...INTENTS],
            description:
              "buying_intent: actively looking for a solution or asking for recommendations. " +
              "pain_point: describing the problem this product solves, without asking for a tool. " +
              "competitor_complaint: unhappy with a named competitor. " +
              "question: asking about the problem space but not shopping. " +
              "none: not related.",
          },
          score: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description:
              "How valuable this lead is, 0-100. Anchor on the bands in the rubric; do not cluster everything at 50.",
          },
          reason: {
            type: "string",
            description:
              "One sentence, under 30 words, explaining why this matters to this product. Shown to the customer verbatim.",
          },
          reply_angle: {
            type: "string",
            description:
              "One or two sentences on the angle a founder should reply from: what to acknowledge and what to offer. " +
              "Not a message to paste. Empty string when the item is irrelevant.",
          },
        },
      },
    },
  },
} as const;

/**
 * Validate a tool-use payload from the model.
 *
 * Returns the parsed batch or a readable error. A model that returns malformed
 * JSON must degrade to a keyword-only digest, not crash the pipeline, so this
 * never throws.
 */
export function parseClassificationBatch(
  payload: unknown,
): { ok: true; value: ClassificationBatch } | { ok: false; error: string } {
  const parsed = classificationBatchSchema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };
  const detail = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error: detail };
}
