/** Read-only: does the second page (cursor) request return 400? */
import { loadRootEnv } from "@intentowl/core/env";
import { createDb, schema } from "@intentowl/db";
import { eq } from "drizzle-orm";

loadRootEnv();
const { db, pool } = createDb(process.env["DATABASE_URL"] ?? "");
const watch = (await db.select().from(schema.watches).where(eq(schema.watches.active, true)))[0];
await pool.end();
if (watch === undefined) process.exit(1);

const auth = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    identifier: process.env["BLUESKY_IDENTIFIER"],
    password: process.env["BLUESKY_APP_PASSWORD"],
  }),
});
const { accessJwt } = (await auth.json()) as { accessJwt: string };
const H = { authorization: `Bearer ${accessJwt}` };
const U = "https://bsky.social/xrpc/app.bsky.feed.searchPosts";

for (const term of watch.includeTerms) {
  const p1 = await fetch(`${U}?${new URLSearchParams({ q: term, limit: "100", sort: "latest" })}`, { headers: H });
  const b1 = (await p1.json()) as { posts?: unknown[]; cursor?: string };
  const n1 = b1.posts?.length ?? 0;
  if (b1.cursor === undefined || n1 < 100) {
    console.log(`  ${term.padEnd(30)} p1 ${p1.status} (${n1} posts, no page 2)`);
    continue;
  }
  const p2 = await fetch(
    `${U}?${new URLSearchParams({ q: term, limit: "100", sort: "latest", cursor: b1.cursor })}`,
    { headers: H },
  );
  const body = p2.ok ? "" : (await p2.text()).slice(0, 200);
  console.log(`  ${term.padEnd(30)} p1 ${p1.status} (${n1})  p2 ${p2.status}  cursor=${b1.cursor.slice(0, 24)}  ${body}`);
}
