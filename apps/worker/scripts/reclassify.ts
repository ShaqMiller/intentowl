/**
 * One-off: drain the whole backlog through the real classifier.
 *
 * Used to replace the golden-label placeholders with genuine model output
 * before judging M3's digest. Runs the synchronous path rather than the Batch
 * API: the saving on a backlog this size is about seven cents, which is not
 * worth gating a deliverable on an async path that has never run live.
 *
 * Has a hard spend cap. An unattended loop over a paid API is exactly the kind
 * of thing that should not be able to surprise anyone.
 */
import { createClassifier } from "@intentowl/core";
import { createDb, schema } from "@intentowl/db";
import { eq, sql } from "drizzle-orm";

import { env } from "../src/env.ts";
import { runClassify } from "../src/jobs/classify.ts";

const SPEND_CAP_USD = 0.6;
const REAL_EMAIL = "millershaquille533@gmail.com";

const { pool, db } = createDb(env.DATABASE_URL);

// 1. Point the fixture customer at a real inbox.
const [customer] = await db
  .update(schema.customers)
  .set({ email: REAL_EMAIL, name: "Acme Analytics", status: "active" })
  .where(eq(schema.customers.email, "fixture@intentowl.local"))
  .returning({ id: schema.customers.id, email: schema.customers.email });

if (customer === undefined) {
  console.log("fixture customer already updated; looking it up");
}

const [target] = await db
  .select({ id: schema.customers.id })
  .from(schema.customers)
  .where(eq(schema.customers.email, REAL_EMAIL))
  .limit(1);
if (target === undefined) throw new Error("no customer to classify for");

// 2. Drop the placeholder verdicts so the digest cannot mix them with real
//    output, and clear filter decisions so everything is re-considered by the
//    filter as it stands today.
const removed = await db
  .delete(schema.classifications)
  .where(eq(schema.classifications.model, "golden-label"))
  .returning({ itemId: schema.classifications.itemId });

await db
  .update(schema.itemWatches)
  .set({ filteredAt: null, filterReason: null });

console.log(`customer ${target.id} -> ${REAL_EMAIL}`);
console.log(`removed ${removed.length} placeholder classifications`);

// 3. Drain.
const classifier = createClassifier({
  apiKey: env.ANTHROPIC_API_KEY ?? "",
  ...(env.ANTHROPIC_WORKSPACE_ID === undefined
    ? {}
    : { workspaceId: env.ANTHROPIC_WORKSPACE_ID }),
});

let spent = 0;
let round = 0;
for (;;) {
  round += 1;
  const outcome = await runClassify({ db, classifier, limit: 96 });
  spent += outcome.costUsd;

  console.log(
    `round ${round}: candidates ${outcome.candidates}` +
      `  filtered ${outcome.filtered}` +
      `  classified ${outcome.classified}` +
      `  escalated ${outcome.escalated}` +
      `  spent $${spent.toFixed(4)}`,
  );
  for (const w of outcome.warnings) console.log(`  ! ${w}`);

  if (outcome.candidates === 0) break;
  if (spent >= SPEND_CAP_USD) {
    console.log(`stopping: spend cap $${SPEND_CAP_USD} reached`);
    break;
  }
  if (round > 20) {
    console.log("stopping: round cap reached");
    break;
  }
}

const summary = await db.execute<{ model: string; n: number; relevant: number }>(
  sql`select model, count(*)::int n, count(*) filter (where relevant)::int relevant
      from classifications group by model order by n desc`,
);
console.log("classifications by model:", JSON.stringify(summary.rows));
console.log(`total spend: $${spent.toFixed(4)}`);

await pool.end();
