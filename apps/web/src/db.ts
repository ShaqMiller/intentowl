/**
 * Pooled database handle for the web app.
 *
 * The Stripe webhook opens and closes a pool per request, which is right for a
 * route that fires a few times a day. The dashboard issues several queries per
 * page load, so it needs a pool that outlives the request.
 *
 * Cached on globalThis because Next's dev server re-evaluates modules on every
 * edit; without this, an afternoon of Fast Refresh leaves dozens of orphaned
 * pools holding Supabase connections open.
 */
import { createDb, type Db } from "@intentowl/db";

import { env } from "./env.ts";

const CACHE = Symbol.for("intentowl.web.db");

interface Cache {
  [CACHE]?: { db: Db };
}

export function getDb(): Db {
  const url = env.DATABASE_URL;
  if (url === undefined) {
    throw new Error("DATABASE_URL is not set; the dashboard cannot run without it");
  }

  const store = globalThis as unknown as Cache;
  const existing = store[CACHE];
  if (existing !== undefined) return existing.db;

  // One connection per instance. Vercel runs each request in its own
  // serverless instance, so a larger pool reserves connections that instance
  // can never use concurrently — while every other instance does the same,
  // until Supabase's pooler starts refusing them.
  const { db } = createDb(url, { max: 1 });
  store[CACHE] = { db };
  return db;
}
