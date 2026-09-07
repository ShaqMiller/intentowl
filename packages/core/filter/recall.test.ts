/**
 * The pre-filter measured against real, hand-labelled data.
 *
 * This exists because the first implementation passed every unit test in
 * `rules.test.ts` while retaining 5 of 17 real leads. Those fixtures were
 * written to fit the implementation; `golden.json` is 72 posts that actually
 * exist. The lesson is cheap to encode and expensive to relearn: a pure-function
 * test suite proves the function does what you wrote, not that what you wrote is
 * the right function.
 *
 * Free — no network, no model. Belongs in `pnpm test`, not the paid `pnpm eval`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { applyFilter, summarise, type FilterConfig } from "./rules.ts";

interface GoldenCase {
  id: string;
  title: string;
  body: string | null;
  venue: string | null;
  expect: { relevant: boolean };
  note: string;
}

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../classify/evals/golden.json", import.meta.url)),
    "utf8",
  ),
) as { filter: FilterConfig; cases: GoldenCase[] };

/**
 * Floors, not targets.
 *
 * Recall is the one that matters: the spec calls every false negative here an
 * invisible lost lead, and the classifier downstream can reject a marginal item
 * for a tenth of a cent but can never recover a dropped one.
 */
const MIN_RECALL = 0.8;

/**
 * Terms that never fire are dead config reading as coverage. The original bug
 * was 6 of 8 dead. A few legitimately quiet terms are fine — "monitor reddit"
 * belongs on a Reddit watch and this corpus is entirely HN — so the floor is
 * "most terms work", not "all of them".
 */
const MAX_DEAD_TERM_FRACTION = 0.4;

function run() {
  const verdicts = golden.cases.map((c) => ({
    c,
    v: applyFilter(
      { title: c.title, body: c.body, venue: c.venue, author: "someone" },
      golden.filter,
    ),
  }));

  const relevant = verdicts.filter((r) => r.c.expect.relevant);
  const irrelevant = verdicts.filter((r) => !r.c.expect.relevant);
  const keptRelevant = relevant.filter((r) => r.v.keep);
  const keptIrrelevant = irrelevant.filter((r) => r.v.keep);

  return {
    verdicts,
    relevant,
    keptRelevant,
    keptIrrelevant,
    recall: keptRelevant.length / relevant.length,
    precision:
      keptRelevant.length /
      Math.max(keptRelevant.length + keptIrrelevant.length, 1),
  };
}

describe("pre-filter against the golden set", () => {
  it(`retains at least ${MIN_RECALL * 100}% of real leads`, () => {
    const r = run();
    if (r.recall < MIN_RECALL) {
      const missed = r.relevant
        .filter((x) => !x.v.keep)
        .map((x) => `    [${x.v.reason}] ${x.c.title}`)
        .join("\n");
      throw new Error(
        `Pre-filter recall ${(r.recall * 100).toFixed(1)}% is below the ` +
          `${MIN_RECALL * 100}% floor — ` +
          `${r.relevant.length - r.keptRelevant.length} real leads silently lost:\n${missed}`,
      );
    }
    expect(r.recall).toBeGreaterThanOrEqual(MIN_RECALL);
  });

  it("drops every piece of pure off-topic noise", () => {
    // The golden set's Rust and Kubernetes cases share no vocabulary with the
    // product at all. A filter that lets these through is not filtering.
    //
    // Note this is asserted instead of a corpus-wide drop rate: the golden set
    // was harvested with lead-seeking queries, so it is deliberately enriched
    // and nothing like the raw stream. ARCHITECTURE §4.2's "drops 80-90%"
    // describes the real firehose, and asserting it here would measure the
    // sampling, not the filter.
    const r = run();
    const noise = r.verdicts.filter(
      (x) => /rust|kubernetes/i.test(x.c.title) && !x.c.expect.relevant,
    );
    expect(noise.length).toBeGreaterThan(4);
    const leaked = noise.filter((x) => x.v.keep).map((x) => x.c.title);
    expect(leaked, `off-topic noise let through: ${leaked.join("; ")}`).toEqual(
      [],
    );
  });

  it("drops recruitment threads whatever the title prefix", () => {
    // "Ask HN: Who is hiring?" survived the original anchored patterns, and it
    // is the single highest-volume noise thread on the primary venue.
    const r = run();
    for (const title of [
      "Ask HN: Who is hiring? (September 2026)",
      "Ask HN: Who wants to be hired? (September 2026)",
      "[Hiring] Senior Rails developer, remote",
      "r/SaaS Weekly Discussion Thread",
      "Monthly Megathread: self-promotion",
    ]) {
      const v = applyFilter(
        { title, body: "Post your role here, one comment per company.", venue: null, author: "mod" },
        golden.filter,
      );
      expect(v.keep, title).toBe(false);
    }
    expect(r.verdicts).toHaveLength(golden.cases.length);
  });

  it("most configured include terms actually fire", () => {
    const r = run();
    const fired = summarise(r.verdicts.map((x) => x.v)).byTerm;
    const dead = golden.filter.includeTerms.filter(
      (term) => (fired[term] ?? 0) === 0,
    );
    const fraction = dead.length / golden.filter.includeTerms.length;
    expect(
      fraction,
      `${dead.length}/${golden.filter.includeTerms.length} terms never matched: ${dead.join(", ")}`,
    ).toBeLessThanOrEqual(MAX_DEAD_TERM_FRACTION);
  });

  it("reports the filter-stage confusion matrix", () => {
    const r = run();
    console.log(
      `\n  filter stage: recall ${(r.recall * 100).toFixed(1)}%  ` +
        `precision ${(r.precision * 100).toFixed(1)}%  ` +
        `kept ${r.keptRelevant.length + r.keptIrrelevant.length}/${golden.cases.length} ` +
        `(${r.keptRelevant.length} lead, ${r.keptIrrelevant.length} not)\n`,
    );
    expect(r.verdicts).toHaveLength(golden.cases.length);
  });
});
