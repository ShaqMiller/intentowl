import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { draftOnboarding, DRAFT_TOOL_NAME, renderDraftInput, tidyDraft } from "./draft.ts";

const DRAFT = {
  productDesc: "  Invoicing that chases late payments for you.  ",
  icpDesc: "Freelancers and small agencies, likely non-technical.",
  competitors: ["FreshBooks", "freshbooks", " Xero ", ""],
  disqualifiers: ["accountants selling services"],
  includeTerms: ["Chasing Invoices", "chasing invoices", "\"late payment\"", "clients not paying"],
  excludeTerms: ["Who Is Hiring"],
  searchName: "Freelancers chasing late invoices",
};

/** A stand-in for the SDK client that records the request and returns a canned message. */
function fakeClient(content: unknown[], sink: { request?: Record<string, unknown> } = {}) {
  return {
    messages: {
      create: async (request: Record<string, unknown>) => {
        sink.request = request;
        return {
          content,
          stop_reason: "tool_use",
          usage: { input_tokens: 900, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        };
      },
    },
  } as unknown as Anthropic;
}

describe("draftOnboarding", () => {
  it("forces the setup tool with thinking off and tidies the result", async () => {
    const sink: { request?: Record<string, unknown> } = {};
    const client = fakeClient([{ type: "tool_use", id: "t1", name: DRAFT_TOOL_NAME, input: DRAFT }], sink);

    const result = await draftOnboarding({ description: "We chase late invoices for freelancers." }, { client });

    expect(sink.request?.["tool_choice"]).toEqual({ type: "tool", name: DRAFT_TOOL_NAME });
    expect(sink.request?.["thinking"]).toEqual({ type: "disabled" });
    expect(result.draft).toEqual({
      productDesc: "Invoicing that chases late payments for you.",
      icpDesc: "Freelancers and small agencies, likely non-technical.",
      competitors: ["FreshBooks", "Xero"],
      disqualifiers: ["accountants selling services"],
      includeTerms: ["chasing invoices", "\"late payment\"", "clients not paying"],
      excludeTerms: ["who is hiring"],
      searchName: "Freelancers chasing late invoices",
    });
    expect(result.usage).toMatchObject({ tokensIn: 900, tokensOut: 400 });
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("fails clearly when the model does not call the tool", async () => {
    const client = fakeClient([{ type: "text", text: "Sure!" }]);
    await expect(draftOnboarding({ description: "x".repeat(40) }, { client })).rejects.toThrow(/returned no record_setup call/);
  });

  it("rejects a draft missing required fields", async () => {
    const client = fakeClient([{ type: "tool_use", id: "t1", name: DRAFT_TOOL_NAME, input: { ...DRAFT, searchName: "" } }]);
    await expect(draftOnboarding({ description: "x".repeat(40) }, { client })).rejects.toThrow(/invalid draft/);
  });
});

describe("renderDraftInput", () => {
  it("includes optional answers only when given", () => {
    expect(renderDraftInput({ description: "A thing." })).toBe("What the founder sells, in their words:\nA thing.");
    const full = renderDraftInput({ description: "A thing.", audience: "Founders", competitors: "Syften" });
    expect(full).toContain("Who they say buys it:\nFounders");
    expect(full).toContain("Competitors they named:\nSyften");
  });
});

describe("tidyDraft", () => {
  it("caps each list", () => {
    const many = Array.from({ length: 40 }, (_, i) => `term ${i}`);
    const tidy = tidyDraft({ ...DRAFT, includeTerms: many, competitors: many, excludeTerms: many });
    expect(tidy.includeTerms).toHaveLength(25);
    expect(tidy.competitors).toHaveLength(8);
    expect(tidy.excludeTerms).toHaveLength(10);
  });
});
