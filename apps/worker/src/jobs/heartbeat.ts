import { sql } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";

import type { Db } from "@intentowl/db";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";

export const HEARTBEAT_QUEUE = "heartbeat";

/** Every minute. The M0 exit test watches this land in the logs. */
const HEARTBEAT_CRON = "* * * * *";

interface HeartbeatData {
  scheduledFor?: string;
}

/**
 * The liveness job.
 *
 * It is not a console.log on a timer: it proves the whole M0 spine end to end —
 * pg-boss cron fired, a worker picked the job up off a Postgres-backed queue,
 * and the Drizzle pool can still reach the database. If the heartbeat stops,
 * every scheduled job in section 7 has stopped with it.
 */
export async function registerHeartbeat(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(HEARTBEAT_QUEUE, {
    ...DEFAULT_QUEUE_OPTIONS,
    // A stalled minute is not worth replaying: the next tick is 60s away.
    retryLimit: 0,
    expireInSeconds: 30,
    retentionSeconds: 3600,
    deleteAfterSeconds: 3600,
  });

  await boss.work<HeartbeatData>(
    HEARTBEAT_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await runHeartbeat(job, db);
      }
    },
  );

  // schedule() is an upsert keyed on (queue, key), so re-registering on every
  // boot neither duplicates nor drifts the cron.
  await boss.schedule(HEARTBEAT_QUEUE, HEARTBEAT_CRON, null, { tz: "UTC" });

  logger.info(
    { queue: HEARTBEAT_QUEUE, cron: HEARTBEAT_CRON },
    "heartbeat scheduled",
  );
}

async function runHeartbeat(job: Job<HeartbeatData>, db: Db): Promise<void> {
  const startedAt = Date.now();
  const result = await db.execute<{ now: Date }>(sql`select now() as now`);
  const dbLatencyMs = Date.now() - startedAt;

  logger.info(
    {
      queue: HEARTBEAT_QUEUE,
      job_id: job.id,
      db_time: result.rows[0]?.now ?? null,
      db_latency_ms: dbLatencyMs,
    },
    "heartbeat",
  );
}
