/**
 * Shared Postgres pool + Drizzle client.
 *
 * The same pool backs both Drizzle and pg-boss in the worker, which is the
 * whole point of a Postgres-backed queue: one datastore, one connection story.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>["db"];

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    // Supabase's pooler is happier with a modest per-process ceiling, and the
    // worker is one process doing batched work, not serving HTTP traffic.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(connectionString: string) {
  const pool = createPool(connectionString);
  const db = drizzle(pool, { schema });
  return { pool, db };
}
