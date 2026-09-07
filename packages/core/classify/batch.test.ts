import Anthropic from "@anthropic-ai/sdk";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  buildBatchRequests,
  collectBatch,
  decodeCustomId,
  encodeCustomId,
  getBatchState,
  submitBatch,
  type BatchGroup,
} from "./batch.ts";
import { HAIKU_MODEL } from "./classifier.ts";
import type { CustomerProfile } from "./prompt.ts";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Constructed per test, never at module scope: the SDK captures a fetch
 * reference on construction, and a client built before server.listen() keeps
 * the unpatched one — msw silently stops intercepting and the suite starts
 * making real network calls.
 */
function makeClient(): Anthropic {
  return new Anthropic({ apiKey: "test-key" });
}

const WATCH_A = "0647fe18-6553-4bdd-a844-7bc5477008d6";
const WATCH_B = "23c3dd85-b43f-441f-90b0-544130952f15";

const profile: CustomerProfile = {
  name: "IntentOwl",
  productDesc: "A daily intent-lead digest for SaaS founders.",
  icpDesc: "Solo founders doing community marketing by hand.",
  competitors: ["GummySearch"],
  disqualifiers: ["Job postings"],
};

function group(watchId: string, count: number): BatchGroup {
  return {
    watchId,
    request: {
      profile,
      items: Array.from({ length: count }, (_, i) => ({
        id: `item-${watchId.slice(0, 4)}-${i}`,
        source: "hn",
        venue: "news.ycombinator.com",
        title: `Post number ${i}`,
        body: "Some body text.",
      })),
    },
  };
}

describe("custom_id encoding", () => {
  it("round-trips a watch id", () => {
    const id = encodeCustomId(WATCH_A, 3);
    expect(decodeCustomId(id)).toEqual({ watchId: WATCH_A });
  });

  it("stays inside Anthropic's 64-character ceiling", () => {
    // A dashed UUID pair would be 73 characters and silently 400 at submit.
    expect(encodeCustomId(WATCH_A, 999).length).toBeLessThanOrEqual(64);
  });

  it("returns null for an id it did not write", () => {
    expect(decodeCustomId("not-a-custom-id")).toBeNull();
    expect(decodeCustomId("")).toBeNull();
  });
});

describe("buildBatchRequests", () => {
  it("splits each group into sub-requests of the configured size", () => {
    const requests = buildBatchRequests(HAIKU_MODEL, [group(WATCH_A, 25)], {
      subRequestSize: 12,
    });
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.params.model === HAIKU_MODEL)).toBe(true);
  });

  it("gives every sub-request a unique custom_id", () => {
    const requests = buildBatchRequests(
      HAIKU_MODEL,
      [group(WATCH_A, 25), group(WATCH_B, 13)],
      { subRequestSize: 12 },
    );
    const ids = requests.map((r) => r.custom_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps each sub-request routable back to its watch", () => {
    const requests = buildBatchRequests(
      HAIKU_MODEL,
      [group(WATCH_A, 13), group(WATCH_B, 13)],
      { subRequestSize: 12 },
    );
    const watches = requests.map((r) => decodeCustomId(r.custom_id)?.watchId);
    expect(watches.filter((w) => w === WATCH_A)).toHaveLength(2);
    expect(watches.filter((w) => w === WATCH_B)).toHaveLength(2);
  });

  it("carries the same prompt the synchronous path sends", () => {
    // If these ever diverge, `pnpm eval` (synchronous) stops measuring what
    // production (batch) actually runs.
    const requests = buildBatchRequests(HAIKU_MODEL, [group(WATCH_A, 2)]);
    const params = requests[0]?.params;
    expect(params?.tool_choice).toEqual({
      type: "tool",
      name: "record_classifications",
    });
    const tool = params?.tools?.[0];
    expect(tool !== undefined && "name" in tool && tool.name).toBe(
      "record_classifications",
    );
    const system = params?.system;
    expect(Array.isArray(system) && system[0]?.text).toContain("Scoring bands");
  });

  it("returns nothing for empty groups", () => {
    expect(buildBatchRequests(HAIKU_MODEL, [])).toEqual([]);
    expect(buildBatchRequests(HAIKU_MODEL, [group(WATCH_A, 0)])).toEqual([]);
  });
});

describe("submitBatch", () => {
  it("posts the requests and returns the batch id", async () => {
    let received: unknown = null;
    server.use(
      http.post("https://api.anthropic.com/v1/messages/batches", async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          id: "msgbatch_01abc",
          type: "message_batch",
          processing_status: "in_progress",
          request_counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
          created_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
        });
      }),
    );

    const result = await submitBatch(makeClient(), HAIKU_MODEL, [group(WATCH_A, 15)], {
      subRequestSize: 12,
    });

    expect(result).toMatchObject({ batchId: "msgbatch_01abc", requestCount: 2, itemCount: 15 });
    expect((received as { requests: unknown[] }).requests).toHaveLength(2);
  });

  it("submits nothing when there is nothing to classify", async () => {
    // No msw handler registered — a request here would throw.
    await expect(submitBatch(makeClient(), HAIKU_MODEL, [])).resolves.toBeNull();
  });
});

describe("getBatchState", () => {
  it("treats canceling as still in flight", async () => {
    server.use(
      http.get("https://api.anthropic.com/v1/messages/batches/:id", () =>
        HttpResponse.json({
          id: "msgbatch_01abc",
          type: "message_batch",
          processing_status: "canceling",
          request_counts: { processing: 1, succeeded: 1, errored: 0, canceled: 0, expired: 0 },
          created_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
        }),
      ),
    );
    const { state } = await getBatchState(makeClient(), "msgbatch_01abc");
    expect(state).toBe("in_progress");
  });
});

describe("collectBatch", () => {
  function resultLine(customId: string, itemIds: string[]) {
    return JSON.stringify({
      custom_id: customId,
      result: {
        type: "succeeded",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: HAIKU_MODEL,
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 300 },
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "record_classifications",
              input: {
                classifications: itemIds.map((id, i) => ({
                  item_id: id,
                  relevant: i === 0,
                  intent: i === 0 ? "buying_intent" : "none",
                  score: i === 0 ? 82 : 6,
                  reason: "A reason sentence.",
                  reply_angle: i === 0 ? "An angle." : "",
                })),
              },
            },
          ],
        },
      },
    });
  }

  const RESULTS_URL =
    "https://api.anthropic.com/v1/messages/batches/msgbatch_01abc/results";

  /**
   * `results()` retrieves the batch first and then GETs its `results_url`, so
   * both hops have to be served.
   */
  function serveResults(lines: string[]) {
    server.use(
      http.get("https://api.anthropic.com/v1/messages/batches/:id", () =>
        HttpResponse.json({
          id: "msgbatch_01abc",
          type: "message_batch",
          processing_status: "ended",
          results_url: RESULTS_URL,
          request_counts: {
            processing: 0,
            succeeded: lines.length,
            errored: 0,
            canceled: 0,
            expired: 0,
          },
          created_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        }),
      ),
      http.get(RESULTS_URL, () =>
        HttpResponse.text(lines.join("\n"), {
          headers: { "content-type": "application/x-jsonl" },
        }),
      ),
    );
  }

  it("routes every verdict back to the right watch", async () => {
    serveResults([
      resultLine(encodeCustomId(WATCH_A, 0), ["a1", "a2"]),
      resultLine(encodeCustomId(WATCH_B, 1), ["b1"]),
    ]);

    const collected = await collectBatch(makeClient(), HAIKU_MODEL, "msgbatch_01abc");

    expect(collected.verdicts).toHaveLength(3);
    expect(collected.verdicts.filter((v) => v.watchId === WATCH_A)).toHaveLength(2);
    expect(collected.verdicts.filter((v) => v.watchId === WATCH_B)).toHaveLength(1);
    expect(collected.usage).toHaveLength(2);
    expect(collected.warnings).toEqual([]);
  });

  it("surfaces a failed request instead of dropping it silently", async () => {
    // An expired batch that vanished without a warning would look exactly like
    // a quiet day with no leads.
    serveResults([
      resultLine(encodeCustomId(WATCH_A, 0), ["a1"]),
      JSON.stringify({
        custom_id: encodeCustomId(WATCH_B, 1),
        result: { type: "expired" },
      }),
    ]);

    const collected = await collectBatch(makeClient(), HAIKU_MODEL, "msgbatch_01abc");
    expect(collected.verdicts).toHaveLength(1);
    expect(collected.warnings.join(" ")).toContain("expired");
  });

  it("warns on a custom_id it cannot route", async () => {
    serveResults([
      JSON.stringify({ custom_id: "garbage", result: { type: "succeeded", message: null } }),
    ]);
    const collected = await collectBatch(makeClient(), HAIKU_MODEL, "msgbatch_01abc");
    expect(collected.verdicts).toEqual([]);
    expect(collected.warnings.join(" ")).toContain("unrecognised custom_id");
  });
});
