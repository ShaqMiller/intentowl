import { PgBoss } from "pg-boss";

import { env } from "./env.ts";
import { logger } from "./logger.ts";

/**
 * The pg-boss instance: queues, cron, retries and singleton locks, all inside
 * the same Postgres the app already uses (ARCHITECTURE.md section 1 and 11 —
 * no Redis, one datastore, one backup story).
 *
 * pg-boss keeps its tables in a dedicated `pgboss` schema and installs or
 * migrates them itself on `start()`. It is deliberately not modelled in the
 * Drizzle schema.
 */
export function createBoss(): PgBoss {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    application_name: "intentowl-worker",
    schema: "pgboss",
    // A separate small pool from the Drizzle one: queue polling should never
    // be starved by a long-running batch classification holding connections.
    max: 5,
    // Cron scheduling and the maintenance/supervisor loops are what make the
    // poll, digest and ops jobs of section 7 possible. All on by default; named
    // here because they are load-bearing, not incidental.
    schedule: true,
    supervise: true,
    migrate: true,
  });

  boss.on("error", (error) => {
    logger.error({ err: error }, "pg-boss error");
  });

  boss.on("warning", (warning) => {
    logger.warn({ warning }, "pg-boss warning");
  });

  return boss;
}

/**
 * Queue defaults shared by every job in the system: retry 3x with exponential
 * backoff, then land in pg-boss's failed state for `ops-daily` to report
 * (ARCHITECTURE.md section 4.9).
 */
export const DEFAULT_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryBackoff: true,
  retryDelay: 5,
} as const;
