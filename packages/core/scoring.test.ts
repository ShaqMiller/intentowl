import { describe, expect, it } from "vitest";

import {
  collapseDuplicates,
  duplicateKey,
  engagementWeight,
  groupForDigest,
  rankLeads,
  recencyWeight,
  venueWeight,
  type ScorableLead,
} from "./scoring.ts";

const NOW = new Date("2026-09-07T12:00:00Z");

function lead(overrides: Partial<ScorableLead> = {}): ScorableLead {
  return {
    itemId: "item-1",
    score: 80,
    relevant: true,
    intent: "buying_intent",
    title: "Anyone know a tool to monitor Reddit for my niche?",
    body: "We keep missing threads.",
    url: "https://reddit.com/r/SaaS/1",
    venue: "r/SaaS",
    author: "founder_jane",
    postedAt: new Date("2026-09-07T11:00:00Z"),
    reason: "Asking for exactly this category.",
    replyAngle: "Acknowledge the manual scrolling.",
    engagement: { score: 12, comments: 4 },
    ...overrides,
  };
}

describe("recencyWeight", () => {
  it("halves over the half-life", () => {
    const posted = new Date(NOW.getTime() - 24 * 3_600_000);
    expect(recencyWeight(posted, NOW, 24)).toBeCloseTo(0.5, 3);
  });

  it("is 1 for something posted now or in the future", () => {
    expect(recencyWeight(NOW, NOW, 24)).toBe(1);
    // Clock skew between us and a provider must not produce a >1 boost.
    expect(recencyWeight(new Date(NOW.getTime() + 60_000), NOW, 24)).toBe(1);
  });

  it("floors rather than decaying to nothing", () => {
    const ancient = new Date(NOW.getTime() - 400 * 24 * 3_600_000);
    // An outstanding old lead should sink, not disappear.
    expect(recencyWeight(ancient, NOW, 24)).toBe(0.15);
  });

  it("treats a missing timestamp as fresh", () => {
    // Penalising a null would silently bury every source whose adapter does
    // not supply a date.
    expect(recencyWeight(null, NOW, 24)).toBe(1);
  });
});

describe("engagementWeight", () => {
  it("stays a nudge, never a driver", () => {
    // The HN front page is enormously engaged and almost never a lead.
    const huge = engagementWeight({ score: 5000, comments: 2000 });
    expect(huge).toBeLessThanOrEqual(1.25);
    expect(huge).toBeGreaterThan(1);
  });

  it("weighs comments above upvotes", () => {
    const comments = engagementWeight({ score: 0, comments: 10 });
    const upvotes = engagementWeight({ score: 10, comments: 0 });
    expect(comments).toBeGreaterThan(upvotes);
  });

  it("mildly penalises a thread nobody engaged with", () => {
    expect(engagementWeight({ score: 0, comments: 0 })).toBe(0.9);
  });

  it("is neutral when the source gave us nothing", () => {
    expect(engagementWeight(null)).toBe(1);
  });

  it("ignores non-numeric junk in the payload", () => {
    expect(engagementWeight({ score: "lots", comments: null })).toBe(0.9);
  });
});

describe("venueWeight", () => {
  it("defaults to 1 and honours a configured weight", () => {
    expect(venueWeight("r/SaaS", undefined)).toBe(1);
    expect(venueWeight("r/SaaS", { "r/SaaS": 1.4 })).toBe(1.4);
    expect(venueWeight("r/Other", { "r/SaaS": 1.4 })).toBe(1);
  });
});

describe("duplicateKey / collapseDuplicates", () => {
  it("matches the same author posting near-identical titles", () => {
    const a = lead({ title: "Anyone know a tool to monitor Reddit for my niche?" });
    const b = lead({ title: "Anyone know a tool to monitor Reddit for my startup?" });
    expect(duplicateKey(a)).toBe(duplicateKey(b));
  });

  it("does not collapse different authors", () => {
    const a = lead({ author: "jane" });
    const b = lead({ author: "bob" });
    expect(duplicateKey(a)).not.toBe(duplicateKey(b));
  });

  it("does not collapse genuinely different posts by the same author", () => {
    const a = lead({ title: "Anyone know a tool to monitor Reddit?" });
    const b = lead({ title: "How do you price an annual plan for B2B?" });
    expect(duplicateKey(a)).not.toBe(duplicateKey(b));
  });

  it("keeps the best copy and attaches the rest as links", () => {
    const collapsed = collapseDuplicates([
      lead({ itemId: "a", score: 60, url: "https://reddit.com/r/SaaS/1", venue: "r/SaaS" }),
      lead({ itemId: "b", score: 88, url: "https://reddit.com/r/startups/2", venue: "r/startups" }),
      lead({ itemId: "c", score: 71, url: "https://reddit.com/r/Entrepreneur/3", venue: "r/Entrepreneur" }),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.lead.itemId).toBe("b");
    expect(collapsed[0]?.duplicates).toHaveLength(2);
  });
});

describe("rankLeads", () => {
  it("drops irrelevant and low-scoring leads", () => {
    const ranked = rankLeads(
      [
        lead({ itemId: "a", relevant: false, score: 90 }),
        lead({ itemId: "b", score: 20, author: "b" }),
        lead({ itemId: "c", score: 75, author: "c" }),
      ],
      { now: NOW, minScore: 40 },
    );
    expect(ranked.map((r) => r.itemId)).toEqual(["c"]);
  });

  it("puts a fresher lead above an older one of equal score", () => {
    const ranked = rankLeads(
      [
        lead({ itemId: "old", author: "old", postedAt: new Date("2026-09-04T12:00:00Z") }),
        lead({ itemId: "new", author: "new", postedAt: new Date("2026-09-07T11:30:00Z") }),
      ],
      { now: NOW },
    );
    expect(ranked[0]?.itemId).toBe("new");
  });

  it("lets a big score beat recency — decay ranks, it does not censor", () => {
    const ranked = rankLeads(
      [
        lead({ itemId: "great-old", author: "a", score: 98, postedAt: new Date("2026-09-06T12:00:00Z") }),
        lead({ itemId: "ok-new", author: "b", score: 45, postedAt: NOW }),
      ],
      { now: NOW },
    );
    expect(ranked[0]?.itemId).toBe("great-old");
  });

  it("applies venue weight", () => {
    const ranked = rankLeads(
      [
        lead({ itemId: "weighted", author: "a", venue: "r/SaaS" }),
        lead({ itemId: "plain", author: "b", venue: "r/Other" }),
      ],
      { now: NOW, venueWeights: { "r/SaaS": 1.5 } },
    );
    expect(ranked[0]?.itemId).toBe("weighted");
  });

  it("exposes the factor breakdown so an ordering can be explained", () => {
    const [top] = rankLeads([lead()], { now: NOW });
    expect(top?.factors).toMatchObject({ base: 80 });
    expect(top?.rank).toBeCloseTo(
      (top?.factors.base ?? 0) *
        (top?.factors.recency ?? 0) *
        (top?.factors.venue ?? 0) *
        (top?.factors.engagement ?? 0),
      6,
    );
  });

  it("is deterministic for equal ranks", () => {
    const input = [
      lead({ itemId: "b", author: "x", engagement: null, postedAt: null }),
      lead({ itemId: "a", author: "y", engagement: null, postedAt: null }),
    ];
    expect(rankLeads(input, { now: NOW }).map((r) => r.itemId)).toEqual(["a", "b"]);
  });

  it("returns nothing when there is nothing to send", () => {
    expect(rankLeads([], { now: NOW })).toEqual([]);
  });
});

describe("groupForDigest", () => {
  it("orders groups by how a founder should read them", () => {
    const ranked = rankLeads(
      [
        lead({ itemId: "q", author: "q", intent: "question", score: 95 }),
        lead({ itemId: "c", author: "c", intent: "competitor_complaint", score: 60 }),
        lead({ itemId: "b", author: "b", intent: "buying_intent", score: 55 }),
      ],
      { now: NOW },
    );
    expect(groupForDigest(ranked).map((g) => g.intent)).toEqual([
      "buying_intent",
      "competitor_complaint",
      "question",
    ]);
  });

  it("caps the digest and omits empty groups", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      lead({ itemId: `i${i}`, author: `a${i}`, score: 50 + (i % 40) }),
    );
    const groups = groupForDigest(rankLeads(many, { now: NOW }), 15);
    expect(groups.reduce((n, g) => n + g.leads.length, 0)).toBe(15);
    expect(groups.every((g) => g.leads.length > 0)).toBe(true);
  });
});
