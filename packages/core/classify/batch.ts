/**
 * Batch API classification — 50% off, overnight (ARCHITECTURE.md section 4.3).
 *
 * The digest is daily, so classification latency is worth nothing to the
 * customer. Trading it for half the bill is the single largest cost lever in
 * the pipeline, and unlike prompt caching it has no minimum-prefix condition
 * to satisfy: the discount applies to input *and* output, at any size.
 *
 * Shape of the trade:
 *   sync   ~$0.001/item, verdict in seconds, every 5 minutes
 *   batch  ~$0.0005/item, verdict within 24h (usually minutes)
 *
 * Every request in a batch carries a full Messages payload, so one submission
 * can span many customers — each sub-request built by the *same*
 * `buildRequestParams` the synchronous path uses, so the two cannot drift.
 */
import type Anthropic from "@anthropic-ai/sdk";

import {
  buildRequestParams,
  extractClassifications,
  type ClassifyRequest,
  type ClassifyUsage,
} from "./classifier.ts";
import type { Classification } from "./schema.ts";

/**
 * Items per sub-request. Each one carries the rubric, so batching amortises it
 * exactly as the synchronous path does — one item per request would multiply
 * the ~1,050-token rubric by the item count.
 */
export const BATCH_SUB_REQUEST_SIZE = 12;

/** Anthropic caps `custom_id` at 64 characters. */
const MAX_CUSTOM_ID = 64;

export interface BatchGroup {
  watchId: string;
  request: ClassifyRequest;
}

export interface SubmittedBatch {
  batchId: string;
  requestCount: number;
  itemCount: number;
}

/**
 * Encode the watch a sub-request belongs to into its `custom_id`.
 *
 * A UUID's hex form is 32 characters, so `<watch><index>` fits comfortably
 * inside the 64-character ceiling. The *items* need no encoding: the model
 * echoes `item_id` in every classification, and the caller re-validates those
 * against `item_watches` rather than trusting them.
 */
export function encodeCustomId(watchId: string, index: number): string {
  const id = `${watchId.replace(/-/g, "")}-${index}`;
  if (id.length > MAX_CUSTOM_ID) {
    throw new Error(`custom_id "${id}" exceeds ${MAX_CUSTOM_ID} characters`);
  }
  return id;
}

export function decodeCustomId(customId: string): { watchId: string } | null {
  const hex = customId.split("-")[0];
  if (hex === undefined || !/^[0-9a-f]{32}$/.test(hex)) return null;
  return {
    watchId: [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-"),
  };
}

/** Split each group's items into sub-requests and build the batch payload. */
export function buildBatchRequests(
  model: string,
  groups: readonly BatchGroup[],
  options: { disableThinking?: boolean; subRequestSize?: number } = {},
): Anthropic.Messages.BatchCreateParams["requests"] {
  const size = options.subRequestSize ?? BATCH_SUB_REQUEST_SIZE;
  const disableThinking = options.disableThinking ?? false;
  const requests: Anthropic.Messages.BatchCreateParams["requests"] = [];

  for (const group of groups) {
    const items = [...group.request.items];
    for (let i = 0; i < items.length; i += size) {
      const slice = items.slice(i, i + size);
      if (slice.length === 0) continue;
      requests.push({
        custom_id: encodeCustomId(group.watchId, requests.length),
        params: buildRequestParams(
          model,
          { ...group.request, items: slice },
          disableThinking,
        ) as Anthropic.Messages.BatchCreateParams["requests"][number]["params"],
      });
    }
  }

  return requests;
}

export async function submitBatch(
  client: Anthropic,
  model: string,
  groups: readonly BatchGroup[],
  options: { disableThinking?: boolean; subRequestSize?: number } = {},
): Promise<SubmittedBatch | null> {
  const requests = buildBatchRequests(model, groups, options);
  if (requests.length === 0) return null;

  const batch = await client.messages.batches.create({ requests });
  return {
    batchId: batch.id,
    requestCount: requests.length,
    itemCount: groups.reduce((sum, g) => sum + g.request.items.length, 0),
  };
}

export type BatchState = "in_progress" | "ended";

export async function getBatchState(
  client: Anthropic,
  batchId: string,
): Promise<{ state: BatchState; counts: Anthropic.Messages.MessageBatchRequestCounts }> {
  const batch = await client.messages.batches.retrieve(batchId);
  return {
    // "canceling" is still work in flight; only "ended" means results exist.
    state: batch.processing_status === "ended" ? "ended" : "in_progress",
    counts: batch.request_counts,
  };
}

export interface BatchVerdict {
  watchId: string;
  classification: Classification;
}

export interface CollectedBatch {
  verdicts: BatchVerdict[];
  usage: ClassifyUsage[];
  warnings: string[];
}

/**
 * Stream a finished batch's results.
 *
 * Results arrive in arbitrary order and each line reports its own outcome, so
 * every line is routed by `custom_id` and every non-success is surfaced rather
 * than silently skipped — an expired batch that vanished without a warning
 * would look exactly like a quiet day with no leads.
 */
export async function collectBatch(
  client: Anthropic,
  model: string,
  batchId: string,
): Promise<CollectedBatch> {
  const verdicts: BatchVerdict[] = [];
  const usage: ClassifyUsage[] = [];
  const warnings: string[] = [];

  const results = await client.messages.batches.results(batchId);

  for await (const entry of results) {
    const decoded = decodeCustomId(entry.custom_id);
    if (decoded === null) {
      warnings.push(`unrecognised custom_id in batch ${batchId}: ${entry.custom_id}`);
      continue;
    }

    if (entry.result.type !== "succeeded") {
      // errored | canceled | expired — all mean "no verdicts for these items",
      // and all leave those items still pending, to be retried next run.
      warnings.push(
        `batch ${batchId} request ${entry.custom_id}: ${entry.result.type}`,
      );
      continue;
    }

    const message = entry.result.message;
    usage.push({
      model,
      tokensIn: message.usage.input_tokens,
      tokensOut: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    });

    const extracted = extractClassifications(model, message);
    warnings.push(...extracted.warnings);
    for (const classification of extracted.classifications) {
      verdicts.push({ watchId: decoded.watchId, classification });
    }
  }

  return { verdicts, usage, warnings };
}

/**
 * Batch pricing is half the synchronous rate, on input and output alike.
 * Applied on top of `estimateCostUsd` rather than duplicating the rate table.
 */
export const BATCH_DISCOUNT = 0.5;
