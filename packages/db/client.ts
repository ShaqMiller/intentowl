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

export interface PoolOptions {
  /**
   * Connections per pool.
   *
   * Defaults to 10, which suits the worker: one long-lived process doing
   * batched work. It is actively wrong on serverless, where every instance
   * builds its own pool but only ever handles one request at a time — ten
   * instances would reserve a hundred connections to do the work of ten, and
   * Supabase's pooler starts refusing long before that. Pass 1 there.
   */
  max?: number;
}

export function createPool(
  connectionString: string,
  options: PoolOptions = {},
): Pool {
  return new Pool({
    connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(connectionString: string, options: PoolOptions = {}) {
  const pool = createPool(connectionString, options);
  const db = drizzle(pool, { schema });
  return { pool, db };
}
