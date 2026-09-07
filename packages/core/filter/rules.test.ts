import { describe, expect, it } from "vitest";

import {
  applyFilter,
  normalise,
  stem,
  summarise,
  termMatches,
  termTokens,
  type FilterConfig,
} from "./rules.ts";

const config: FilterConfig = {
  includeTerms: ["lead generation", "monitor reddit", "find customers"],
  excludeTerms: ["upwork", '"for hire"'],
};

function item(overrides: Partial<Parameters<typeof applyFilter>[0]> = {}) {
  return {
    title: "Anyone know a tool for lead generation on Reddit?",
    body: "We keep missing threads where people ask for what we build.",
    venue: "r/SaaS",
    author: "founder_jane",
    ...overrides,
  };
}

/** Convenience: build the token set the way applyFilter does. */
function match(text: string, term: string): boolean {
  const h = normalise(text);
  return termMatches(h, new Set(h === "" ? [] : h.split(" ").map(stem)), term);
}

describe("normalise", () => {
  it("lowercases and collapses punctuation to single spaces", () => {
    expect(normalise("Lead-Generation,  really?!")).toBe("lead generation really");
  });

  it("keeps + and # so c++ and c# stay distinct", () => {
    expect(normalise("C++ vs C#")).toBe("c++ vs c#");
  });

  it("folds accents instead of shredding the word", () => {
    // The original stripped the combining mark's base letter too, turning
    // "naïve" into "na ve" — strictly worse than dropping the diacritic.
    expect(normalise("naïve résumé")).toBe("naive resume");
  });

  it("yields an empty string for non-Latin script", () => {
    // Deliberate: applyFilter reports this as not_latin_script, not no_text.
    expect(normalise("スタートアップ")).toBe("");
  });
});

describe("stem", () => {
  it("folds regular plurals", () => {
    expect(stem("customers")).toBe("customer");
    expect(stem("users")).toBe("user");
  });

  it("handles -ies and -es", () => {
    expect(stem("companies")).toBe("company");
    expect(stem("watches")).toBe("watch");
  });

  it("leaves short words and -ss endings alone", () => {
    expect(stem("as")).toBe("as");
    expect(stem("saas")).toBe("saas");
    expect(stem("business")).toBe("business");
  });
});

describe("termTokens", () => {
  it("drops stopwords so interpolated words cannot break a match", () => {
    expect(termTokens("marketing as a solo founder")).toEqual([
      "marketing",
      "solo",
      "founder",
    ]);
  });

  it("keeps selective words like 'how' and 'get' — they are not stopwords", () => {
    // Deliberately narrow list: with "get" removed as a stopword, "get users"
    // stays two tokens instead of collapsing to the generic "user".
    expect(termTokens("get more users")).toEqual(["get", "more", "user"]);
  });

  it("falls back to literal tokens when a term is all stopwords", () => {
    expect(termTokens("of the")).toEqual(["of", "the"]);
  });
});

describe("termMatches", () => {
  it("matches words that are separated in the text", () => {
    // The bug that cost 12 of 17 real leads: the text says "find YOUR first
    // customers", the term says "find first customers".
    expect(match("How did you find your first 10 customers?", "find first customers")).toBe(true);
    expect(match("How to market my API SaaS?", "market saas")).toBe(true);
    expect(match("How do you handle marketing as a solo technical founder?", "marketing solo")).toBe(true);
  });

  it("matches across singular and plural", () => {
    expect(match("How did you find your first customer?", "first customers")).toBe(true);
  });

  it("matches regardless of word order", () => {
    expect(match("Solo-founder question regarding marketing", "marketing founder")).toBe(true);
  });

  it("still requires every content word to be present", () => {
    expect(match("How did you find your first customers?", "monitor reddit")).toBe(false);
    expect(match("Monitoring my brand", "monitor reddit")).toBe(false);
  });

  it("matches on word boundaries, not substrings", () => {
    expect(match("he said it", "ai")).toBe(false);
    expect(match("we use ai here", "ai")).toBe(true);
  });

  it("treats hyphens and spaces as equivalent", () => {
    expect(match("our lead-generation stack", "lead generation")).toBe(true);
  });

  it("honours a quoted term as an exact phrase", () => {
    expect(match("who is hiring this month", '"who is hiring"')).toBe(true);
    // The whole point of the escape hatch: quoting restores strictness.
    expect(match("who is currently hiring", '"who is hiring"')).toBe(false);
  });

  it("is false for an empty term", () => {
    expect(match("anything", "  ")).toBe(false);
  });
});

describe("applyFilter", () => {
  it("keeps an item matching an include term and reports which", () => {
    const v = applyFilter(item(), config);
    expect(v.keep).toBe(true);
    expect(v.matched).toEqual(["lead generation"]);
    expect(v.reason).toBeNull();
  });

  it("drops an item matching no include term", () => {
    const v = applyFilter(
      item({
        title: "My thoughts on Kubernetes networking",
        body: "A long post about CNI plugins and how they route traffic.",
      }),
      config,
    );
    expect(v.keep).toBe(false);
    expect(v.reason).toBe("no_include_match");
  });

  it("lets exclusions beat inclusions, and still reports the match", () => {
    const v = applyFilter(
      item({ title: "Upwork gig: lead generation for a SaaS client" }),
      config,
    );
    expect(v.keep).toBe(false);
    expect(v.reason).toBe("excluded_term");
    expect(v.excludedBy).toBe("upwork");
    // Kept so a log can say "excluded despite matching X" — the thing you
    // need in order to debug a customer's watch.
    expect(v.matched).toContain("lead generation");
  });

  it("drops structural noise wherever it sits in the title", () => {
    for (const title of [
      "[Hiring] Senior engineer",
      "Ask HN: Who is hiring? (September 2026)",
      "Ask HN: Who's hiring?",
      "r/SaaS Weekly Discussion Thread",
      "Monthly Megathread: read before posting",
    ]) {
      const v = applyFilter(item({ title }), config);
      expect(v.keep, title).toBe(false);
      expect(v.reason, title).toBe("structural_noise");
    }
  });

  it("drops posts whose author is gone — nobody left to reply to", () => {
    expect(applyFilter(item({ author: "[deleted]" }), config).reason).toBe("deleted_author");
    expect(applyFilter(item({ author: null }), config).reason).toBe("deleted_author");
  });

  it("distinguishes no text from non-Latin text", () => {
    expect(applyFilter(item({ title: null, body: null }), config).reason).toBe("no_text");
    expect(
      applyFilter(item({ title: "Как найти клиентов", body: null }), config).reason,
    ).toBe("not_latin_script");
  });

  it("keeps a short title-only post when the title carries the intent", () => {
    const v = applyFilter(
      item({ title: "Best tool to monitor reddit for my niche?", body: null }),
      config,
    );
    expect(v.keep).toBe(true);
  });

  it("keeps genuinely short title-only leads", () => {
    // These are 23-26 characters and were dropped by the old 40-char floor.
    for (const title of ["How to get my first users?", "Best way to find customers"]) {
      const v = applyFilter(
        item({ title, body: null }),
        { includeTerms: ["first users", "find customers"], excludeTerms: [] },
      );
      expect(v.keep, title).toBe(true);
    }
  });

  it("keeps everything when the watch sets no include terms", () => {
    const v = applyFilter(
      item({ title: "A totally unrelated post about gardening in raised beds" }),
      { includeTerms: [], excludeTerms: [] },
    );
    expect(v.keep).toBe(true);
  });

  it("mutes a venue weighted to zero", () => {
    const v = applyFilter(item(), { ...config, venueWeights: { "r/SaaS": 0 } });
    expect(v.keep).toBe(false);
    expect(v.reason).toBe("muted_venue");
  });

  it("lets a trusted venue in without a keyword hit", () => {
    const v = applyFilter(
      item({ title: "Totally unrelated gardening chatter", body: "Raised beds and compost." }),
      { ...config, venueWeights: { "r/SaaS": 2 } },
    );
    expect(v.keep).toBe(true);
  });
});

describe("summarise", () => {
  it("counts kept, dropped, reasons and which terms fired", () => {
    const verdicts = [
      applyFilter(item(), config),
      applyFilter(item({ title: "Unrelated Kubernetes deep dive on CNI plugin routing" }), config),
      applyFilter(item({ title: "Upwork gig for lead generation" }), config),
    ];
    const s = summarise(verdicts);
    expect(s.kept).toBe(1);
    expect(s.dropped).toBe(2);
    expect(s.byReason).toEqual({ no_include_match: 1, excluded_term: 1 });
    // Surfaces terms that never fire — the original watch had six of eight dead.
    expect(s.byTerm["lead generation"]).toBe(2);
  });
});
