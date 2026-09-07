/**
 * The Haiku-first classification cascade (ARCHITECTURE.md sections 4.3 and 5).
 *
 * Haiku classifies everything. Only items landing in the ambiguous 40-70 band
 * get a second look from Sonnet, so the expensive model is paid for on roughly
 * the hard 10% rather than the whole corpus. That single decision is most of
 * what holds the 85% gross margin at $49/mo.
 *
 * Both calls force the same tool schema, and every result is Zod-validated
 * before it leaves this module.
 */
import Anthropic from "@anthropic-ai/sdk";

import {
  renderItems,
  renderUserMessage,
  RUBRIC,
  type CustomerProfile,
  type FewShot,
  type PromptItem,
} from "./prompt.ts";
import {
  CLASSIFY_TOOL_NAME,
  CLASSIFY_TOOL_SCHEMA,
  parseClassificationBatch,
  type Classification,
} from "./schema.ts";

/** Haiku for volume. */
export const HAIKU_MODEL = "claude-haiku-4-5";
/** Sonnet for the ambiguous band only. */
export const SONNET_MODEL = "claude-sonnet-5";

/**
 * Items scoring inside this band get escalated. Inclusive.
 *
 * 69, not 70: the rubric's own bands are 40-69 ("genuine ambiguity") and 70-84
 * ("clear need plus clear fit"). 70 is also a heavy round-number attractor for
 * LLM scoring, so including it inflated Sonnet volume against the "hard 10%"
 * the margin math assumes.
 */
export const ESCALATION_BAND = { min: 40, max: 69 } as const;

/** Requests are far shorter than this; the SDK default of 10 min equals the
 *  classify queue's whole expiry budget, so one hung call would expire the job. */
const REQUEST_TIMEOUT_MS = 120_000;

export interface ClassifyUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Cached prefix tokens, to verify the rubric cache is actually hitting. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ClassifyResult {
  classifications: Classification[];
  usage: ClassifyUsage[];
  /**
   * Which model actually produced each verdict, by item id.
   *
   * Carried rather than inferred. Deriving it from whether the *final* score
   * lands in the escalation band gets it backwards — an item Sonnet moved from
   * 55 to 85 would be attributed to Haiku, which is precisely the case
   * escalation exists for. Because `model` is part of the unique index on
   * `classifications`, a wrong label also writes contradictory duplicate rows.
   */
  modelByItem: Map<string, string>;
  /** Items escalated to the second model. Items, not batches. */
  escalatedIds: string[];
  /** Items the model failed to return a verdict for, by id. */
  missing: string[];
  /** Non-fatal problems worth logging — a malformed batch, a dropped item. */
  warnings: string[];
}

export interface ClassifierOptions {
  client?: Anthropic;
  apiKey?: string;
  /**
   * Required when the API key is org-scoped rather than workspace-scoped:
   * such a key rejects every request that does not name a workspace.
   */
  workspaceId?: string;
  /** Disable the Sonnet second pass — used by evals measuring Haiku alone. */
  escalate?: boolean;
  haikuModel?: string;
  sonnetModel?: string;
}

export interface ClassifyRequest {
  profile: CustomerProfile;
  items: readonly PromptItem[];
  fewShots?: readonly FewShot[];
}

/**
 * Build the Messages request for one batch of items.
 *
 * Shared verbatim by the synchronous path and the Batch API path. If the two
 * ever built their prompts separately they would drift, and `pnpm eval` — which
 * runs the synchronous path — would stop measuring what production sends.
 */
export function buildRequestParams(
  model: string,
  request: ClassifyRequest,
  disableThinking: boolean,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    // A generous floor, not just a per-item budget. Sizing purely off item
    // count meant a 3-item escalation got ~1,180 tokens — and since Sonnet 5
    // runs adaptive thinking by default, it would spend them all thinking and
    // emit no tool block at all: no verdicts, full bill, one warning line.
    max_tokens: Math.min(16_000, 2_000 + request.items.length * 400),
    // Classification is a judgement the rubric already scaffolds, not a
    // reasoning problem. Thinking here buys little and costs output budget.
    // Haiku 4.5 has no thinking to disable and rejects `effort`.
    ...(disableThinking ? { thinking: { type: "disabled" as const } } : {}),
    system: [
      {
        type: "text",
        text: RUBRIC,
        // Byte-identical across customers and requests, so it is the one thing
        // worth caching. Everything volatile follows it.
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: CLASSIFY_TOOL_NAME,
        description:
          "Record a classification for every item in the batch, in the order given.",
        input_schema:
          CLASSIFY_TOOL_SCHEMA as unknown as Anthropic.Tool["input_schema"],
        // Guarantees arguments validate against the schema before we see them;
        // Zod is the second line of defence.
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: renderUserMessage({
          profile: request.profile,
          ...(request.fewShots === undefined ? {} : { fewShots: request.fewShots }),
          items: request.items,
        }),
      },
    ],
  };
}

/**
 * Pull the classification batch out of a Messages response, wherever it came
 * from — a live call or a Batch API result line.
 */
export function extractClassifications(
  model: string,
  response: Anthropic.Message,
): { classifications: Classification[]; warnings: string[] } {
  const warnings: string[] = [];

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === CLASSIFY_TOOL_NAME,
  );

  if (toolUse === undefined) {
    warnings.push(
      `${model} returned no ${CLASSIFY_TOOL_NAME} call (stop_reason=${response.stop_reason})`,
    );
    return { classifications: [], warnings };
  }

  const parsed = parseClassificationBatch(toolUse.input);
  if (!parsed.ok) {
    warnings.push(`${model} returned an invalid batch: ${parsed.error}`);
    return { classifications: [], warnings };
  }

  return { classifications: parsed.value.classifications, warnings };
}

export function createClassifier(options: ClassifierOptions = {}) {
  const client =
    options.client ??
    new Anthropic({
      timeout: REQUEST_TIMEOUT_MS,
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.workspaceId === undefined
        ? {}
        : { defaultHeaders: { "anthropic-workspace-id": options.workspaceId } }),
    });
  const escalate = options.escalate ?? true;
  const haikuModel = options.haikuModel ?? HAIKU_MODEL;
  const sonnetModel = options.sonnetModel ?? SONNET_MODEL;

  async function callModel(
    model: string,
    request: ClassifyRequest,
  ): Promise<{
    classifications: Classification[];
    usage: ClassifyUsage;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    const response = await client.messages.create(
      buildRequestParams(model, request, model !== haikuModel),
    );

    const usage: ClassifyUsage = {
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    // Degrades rather than throws: silence is the unacceptable failure mode,
    // so a malformed response leaves the caller free to fall back to a
    // keyword-only, flagged digest.
    const extracted = extractClassifications(model, response);
    warnings.push(...extracted.warnings);
    return { classifications: extracted.classifications, usage, warnings };
  }

  return {
    /**
     * Classify a batch. Runs Haiku over everything, then Sonnet over whatever
     * Haiku left in the ambiguous band.
     */
    async classify(request: ClassifyRequest): Promise<ClassifyResult> {
      if (request.items.length === 0) {
        return {
          classifications: [],
          usage: [],
          modelByItem: new Map(),
          escalatedIds: [],
          missing: [],
          warnings: [],
        };
      }

      const first = await callModel(haikuModel, request);
      const usage: ClassifyUsage[] = [first.usage];
      const warnings = [...first.warnings];

      // Index by id rather than trusting order: the model is told to preserve
      // it, but a mismatched batch must not silently misattribute verdicts.
      const byId = new Map<string, Classification>();
      const modelByItem = new Map<string, string>();
      const requestedIds = new Set(request.items.map((item) => item.id));
      for (const c of first.classifications) {
        if (!requestedIds.has(c.item_id)) {
          warnings.push(`${haikuModel} returned an unknown item_id: ${c.item_id}`);
          continue;
        }
        byId.set(c.item_id, c);
        modelByItem.set(c.item_id, haikuModel);
      }

      const escalatedIds: string[] = [];

      if (escalate) {
        const ambiguous = request.items.filter((item) => {
          const verdict = byId.get(item.id);
          if (verdict === undefined) return false;
          return (
            verdict.score >= ESCALATION_BAND.min &&
            verdict.score <= ESCALATION_BAND.max
          );
        });

        if (ambiguous.length > 0) {
          escalatedIds.push(...ambiguous.map((item) => item.id));
          try {
            const second = await callModel(sonnetModel, {
              ...request,
              items: ambiguous,
            });
            usage.push(second.usage);
            warnings.push(...second.warnings);
            // Sonnet's verdict wins where it produced one; where it failed,
            // Haiku's stands rather than the item vanishing.
            for (const c of second.classifications) {
              if (!requestedIds.has(c.item_id)) continue;
              byId.set(c.item_id, c);
              modelByItem.set(c.item_id, sonnetModel);
            }
          } catch (error) {
            // The escalation is optional refinement. Letting a 429 or a timeout
            // unwind the whole batch would discard Haiku's complete, usable
            // verdicts — which have already been paid for — and lose the usage
            // record with them. Degrade exactly as the malformed-response path
            // does, and let the caller see why.
            warnings.push(
              `${sonnetModel} escalation failed, keeping ${haikuModel} verdicts: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      const missing = request.items
        .map((item) => item.id)
        .filter((id) => !byId.has(id));
      if (missing.length > 0) {
        warnings.push(`${missing.length} item(s) received no verdict`);
      }

      return {
        classifications: request.items
          .map((item) => byId.get(item.id))
          .filter((c): c is Classification => c !== undefined),
        usage,
        modelByItem,
        escalatedIds,
        missing,
        warnings,
      };
    },
  };
}

export type Classifier = ReturnType<typeof createClassifier>;

/** Rough USD cost of one batch, for `api_usage`. Rates per million tokens. */
const RATES: Record<string, { in: number; out: number }> = {
  [HAIKU_MODEL]: { in: 1, out: 5 },
  [SONNET_MODEL]: { in: 2, out: 10 },
};

export function estimateCostUsd(usage: readonly ClassifyUsage[]): number {
  let total = 0;
  for (const entry of usage) {
    const rate = RATES[entry.model];
    if (rate === undefined) {
      // A silent zero is the worst possible failure for the one table whose
      // job is proving the margin. Model overrides are the likely cause.
      throw new Error(
        `no cost rate for model "${entry.model}"; add it to RATES before using it`,
      );
    }
    // Cached reads bill at roughly a tenth of the input rate.
    const uncachedIn = entry.tokensIn;
    total +=
      (uncachedIn / 1_000_000) * rate.in +
      (entry.cacheReadTokens / 1_000_000) * rate.in * 0.1 +
      (entry.cacheWriteTokens / 1_000_000) * rate.in * 1.25 +
      (entry.tokensOut / 1_000_000) * rate.out;
  }
  return total;
}

export { renderItems };
