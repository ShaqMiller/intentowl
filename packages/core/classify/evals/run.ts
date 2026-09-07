/**
 * Golden-set eval runner (ARCHITECTURE.md sections 4.3 and 8).
 *
 *   pnpm eval                  Haiku + Sonnet cascade, as production runs
 *   pnpm eval -- --no-escalate Haiku alone, to see what the cascade buys
 *   pnpm eval -- --verbose     print every disagreement
 *
 * M2's exit test is >=80% precision. Precision is the headline because of the
 * asymmetry in the product: a false positive is a bad lead in someone's inbox,
 * which costs trust directly and visibly, while a false negative is invisible.
 * Recall and precision@20 are reported alongside it so a rubric that games
 * precision by marking almost nothing relevant is immediately obvious.
 *
 * This spends real money - roughly a cent per run at current rates. It is the
 * only test in the suite that touches a live API, deliberately: it is
 * measuring the model, not the code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "../../env.ts";
import {
  createClassifier,
  estimateCostUsd,
  type ClassifyUsage,
} from "../classifier.ts";
import type { CustomerProfile, PromptItem } from "../prompt.ts";
import type { Classification, Intent } from "../schema.ts";

interface GoldenCase {
  id: string;
  url: string;
  source: string;
  venue: string | null;
  title: string;
  body: string | null;
  expect: {
    relevant: boolean;
    intent: Intent;
    minScore: number;
    maxScore: number;
  };
  note: string;
}

interface GoldenSet {
  profile: CustomerProfile;
  cases: GoldenCase[];
}

/**
 * Must match apps/worker BATCH_SIZE. Batch size affects precision (attention
 * dilution across a long batch), so an eval measuring a different size to
 * production measures the wrong thing.
 */
const BATCH_SIZE = 12;

/** The bar M2 has to clear. */
const PRECISION_TARGET = 0.8;

function argv(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

async function main(): Promise<number> {
  loadRootEnv();
  if (process.env.ANTHROPIC_API_KEY === undefined) {
    console.error("ANTHROPIC_API_KEY is not set. See .env.example.");
    return 1;
  }

  const goldenPath = fileURLToPath(new URL("./golden.json", import.meta.url));
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenSet;

  const escalate = !argv("no-escalate");
  const verbose = argv("verbose");

  console.log(
    `\ngolden set: ${golden.cases.length} cases ` +
      `(${golden.cases.filter((c) => c.expect.relevant).length} relevant)`,
  );
  console.log(`cascade   : ${escalate ? "Haiku -> Sonnet on 40-70" : "Haiku only"}\n`);

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  const classifier = createClassifier({
    escalate,
    ...(workspaceId === undefined || workspaceId === "" ? {} : { workspaceId }),
  });
  const predictions = new Map<string, Classification>();
  const usage: ClassifyUsage[] = [];
  const warnings: string[] = [];

  const started = Date.now();
  for (let i = 0; i < golden.cases.length; i += BATCH_SIZE) {
    const batch = golden.cases.slice(i, i + BATCH_SIZE);
    const items: PromptItem[] = batch.map((c) => ({
      id: c.id,
      source: c.source,
      venue: c.venue,
      title: c.title,
      body: c.body,
    }));

    process.stdout.write(
      `  batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} items)... `,
    );
    const result = await classifier.classify({ profile: golden.profile, items });
    for (const c of result.classifications) predictions.set(c.item_id, c);
    usage.push(...result.usage);
    warnings.push(...result.warnings);
    process.stdout.write(`${result.classifications.length} verdicts\n`);
  }
  const elapsedMs = Date.now() - started;

  // --- score it -------------------------------------------------------------

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let intentHits = 0;
  let bandHits = 0;
  let judged = 0;

  const falsePositives: { c: GoldenCase; p: Classification }[] = [];
  const falseNegatives: { c: GoldenCase; p: Classification }[] = [];

  for (const c of golden.cases) {
    const p = predictions.get(c.id);
    if (p === undefined) continue;
    judged += 1;

    if (p.relevant && c.expect.relevant) tp += 1;
    else if (p.relevant && !c.expect.relevant) {
      fp += 1;
      falsePositives.push({ c, p });
    } else if (!p.relevant && c.expect.relevant) {
      fn += 1;
      falseNegatives.push({ c, p });
    } else tn += 1;

    if (p.intent === c.expect.intent) intentHits += 1;
    if (p.score >= c.expect.minScore && p.score <= c.expect.maxScore) bandHits += 1;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // Precision@20 by score: the metric the spec says decides whether customers
  // stay, because the digest only ever shows the top of the ranking.
  const ranked = [...predictions.values()].sort((a, b) => b.score - a.score);
  const top20 = ranked.slice(0, 20);
  const expectedById = new Map(golden.cases.map((c) => [c.id, c.expect.relevant]));
  const top20Hits = top20.filter((p) => expectedById.get(p.item_id) === true).length;
  const precisionAt20 = top20.length === 0 ? 0 : top20Hits / top20.length;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  console.log("\n─────────────────────────────────────────────");
  console.log(`  judged            ${judged}/${golden.cases.length}`);
  console.log(`  precision         ${pct(precision)}   (${tp} tp / ${tp + fp} predicted relevant)`);
  console.log(`  recall            ${pct(recall)}   (${tp} tp / ${tp + fn} actually relevant)`);
  console.log(`  F1                ${pct(f1)}`);
  console.log(`  precision@20      ${pct(precisionAt20)}   (${top20Hits}/${top20.length} by score)`);
  console.log(`  intent accuracy   ${pct(intentHits / Math.max(judged, 1))}`);
  console.log(`  score in band     ${pct(bandHits / Math.max(judged, 1))}`);
  console.log(`  confusion         tp=${tp} fp=${fp} fn=${fn} tn=${tn}`);
  console.log("─────────────────────────────────────────────");

  const inTokens = usage.reduce((s, u) => s + u.tokensIn, 0);
  const outTokens = usage.reduce((s, u) => s + u.tokensOut, 0);
  const cacheRead = usage.reduce((s, u) => s + u.cacheReadTokens, 0);
  const cost = estimateCostUsd(usage);
  console.log(
    `  ${usage.length} calls · ${inTokens} in / ${outTokens} out · ` +
      `${cacheRead} cached · ~$${cost.toFixed(4)} · ${(elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(`  cost per 1k items ≈ $${((cost / Math.max(judged, 1)) * 1000).toFixed(2)}\n`);

  for (const w of warnings) console.log(`  ! ${w}`);

  if (falsePositives.length > 0) {
    console.log(`\nFALSE POSITIVES (${falsePositives.length}) — bad leads in the inbox:`);
    for (const { c, p } of falsePositives) {
      console.log(`  · [${p.score}] ${c.title.slice(0, 70)}`);
      console.log(`      model : ${p.reason}`);
      if (verbose) console.log(`      label : ${c.note}`);
    }
  }

  if (falseNegatives.length > 0) {
    console.log(`\nFALSE NEGATIVES (${falseNegatives.length}) — leads we would have missed:`);
    for (const { c, p } of falseNegatives) {
      console.log(`  · [${p.score}] ${c.title.slice(0, 70)}`);
      console.log(`      model : ${p.reason}`);
      if (verbose) console.log(`      label : ${c.note}`);
    }
  }

  const passed = precision >= PRECISION_TARGET;
  console.log(
    `\n${passed ? "PASS" : "FAIL"} — precision ${pct(precision)} ` +
      `vs target ${pct(PRECISION_TARGET)}\n`,
  );
  return passed ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
