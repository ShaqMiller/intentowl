/** Read-only: what was in today's digest, where did it go, and why are polls failing? */
import { loadRootEnv } from "@intentowl/core/env";
import { createDb } from "@intentowl/db";
import { sql } from "drizzle-orm";

loadRootEnv();
const url = process.env["DATABASE_URL"];
if (url === undefined) process.exit(1);

const { db, pool } = createDb(url);
const rows = (r: unknown): Record<string, unknown>[] =>
  Array.isArray(r) ? r : ((r as { rows?: Record<string, unknown>[] }).rows ?? []);

const [leads, target, pollErrors, pollBySource] = await Promise.all([
  db.execute(sql`
    select c.score, c.intent, i.source, i.title, i.url
    from digest_items di
    join digests d on d.id = di.digest_id
    join items i on i.id = di.item_id
    left join lateral (
      select score, intent from classifications
      where item_id = i.id order by score desc limit 1
    ) c on true
    where d.sent_at > now() - interval '8 hours'
    order by c.score desc nulls last
  `),
  db.execute(sql`
    select c.email, c.status, d.sent_at, d.item_count
    from digests d join customers c on c.id = d.customer_id
    order by d.sent_at desc limit 1
  `),
  db.execute(sql`
    select data->>'source' as source,
           left(coalesce(output->>'message', output::text), 220) as err,
           count(*)::int as n, max(created_on) as last
    from pgboss.job
    where name = 'poll' and state = 'failed' and created_on > now() - interval '30 hours'
    group by 1, 2 order by n desc limit 6
  `),
  db.execute(sql`
    select data->>'source' as source, state, count(*)::int as n
    from pgboss.job
    where name = 'poll' and created_on > now() - interval '30 hours'
    group by 1, 2 order by 1, 2
  `),
]);

console.log("=== where it went ===");
for (const t of rows(target)) {
  console.log(`  to ${t["email"]}  (${t["status"]})  at ${t["sent_at"]}  ${t["item_count"]} leads`);
}

console.log("\n=== the 7 leads ===");
for (const l of rows(leads)) {
  console.log(`  [${l["score"]}] ${String(l["intent"]).padEnd(17)} ${l["source"]}`);
  console.log(`        ${String(l["title"]).slice(0, 92)}`);
}

console.log("\n=== poll outcomes by source, last 30h ===");
for (const p of rows(pollBySource)) {
  console.log(`  ${String(p["source"]).padEnd(16)} ${String(p["state"]).padEnd(10)} ${p["n"]}`);
}

console.log("\n=== why polls fail ===");
for (const e of rows(pollErrors)) {
  console.log(`  ${e["source"]}  x${e["n"]}  last ${e["last"]}`);
  console.log(`    ${e["err"]}`);
}

await pool.end();
