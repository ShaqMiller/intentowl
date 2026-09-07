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
  /**
   * One sentence, shown verbatim in the digest as "why it matters".
   *
   * Empty is allowed. The model reasonably returns "" for items it judged
   * irrelevant — there is nothing to explain to a customer who will never see
   * them — and requiring a sentence there made valid batches fail validation.
   * The prompt asks for a reason on relevant items; this is the safety net,
   * not the enforcement.
   */
  reason: z.string().max(400),
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
            // No `minimum`/`maximum`: under `strict: true` the API rejects
            // range keywords on an integer ("For 'integer' type, properties
            // maximum, minimum are not supported"). The bound lives in the
            // description for the model and in the Zod schema for us, which is
            // the layer that actually has to hold anyway — a model can always
            // return something out of range whatever the schema claims.
            description:
              "How valuable this lead is. An integer from 0 to 100 inclusive. Anchor on the bands in the rubric; do not cluster everything at 50.",
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
 * Validate a tool-use payload from the model, item by item.
 *
 * Deliberately lenient about individual entries and strict about the envelope.
 * Validating the whole array at once means one malformed field discards every
 * good verdict beside it — a single empty `reason` cost 12 items their
 * classification on the first live run, and they then looked exactly like items
 * the model had declined to judge.
 *
 * Never throws: a model returning nonsense must degrade to a keyword-only,
 * flagged digest rather than crash the pipeline.
 */
export function parseClassificationBatch(
  payload: unknown,
):
  | { ok: true; value: ClassificationBatch; dropped: string[] }
  | { ok: false; error: string } {
  const envelope = z
    .object({ classifications: z.array(z.unknown()) })
    .safeParse(payload);

  if (!envelope.success) {
    const detail = envelope.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: detail };
  }

  const value: Classification[] = [];
  const dropped: string[] = [];

  envelope.data.classifications.forEach((entry, index) => {
    const parsed = classificationSchema.safeParse(entry);
    if (parsed.success) {
      value.push(parsed.data);
      return;
    }
    const issue = parsed.error.issues[0];
    dropped.push(
      `#${index} (${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "invalid"})`,
    );
  });

  return { ok: true, value: { classifications: value }, dropped };
}
