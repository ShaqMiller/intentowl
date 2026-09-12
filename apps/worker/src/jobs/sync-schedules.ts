/**
 * Re-syncs cron schedules on a timer, not only at boot.
 *
 * `syncSchedules` runs once in `registerJobs`, which was fine while every
 * watch arrived through the seed CLI and a deploy followed. It stopped being
 * fine the moment the dashboard could create one: a customer adding a search
 * would get no polling at all until something happened to restart the worker.
 * Nothing would error — the search would simply sit there looking configured
 * and produce nothing, which is the worst failure shape this product has.
 *
 * Cheap to repeat. `syncSchedules` diffs what exists against what should
 * exist, so a run with no changes is a couple of queries and no writes.
 */
import { type Db } from "@intentowl/db";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";
import { withOpsAlert } from "../ops.ts";
import { syncSchedules } from "./schedules.ts";

export const SYNC_QUEUE = "sync-schedules";

export const SYNC_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 120,
} as const;

export async function registerSyncSchedules(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(SYNC_QUEUE, SYNC_QUEUE_OPTIONS);

  await boss.work(
    SYNC_QUEUE,
    { batchSize: 1 },
    withOpsAlert(SYNC_QUEUE, async () => {
      const result = await syncSchedules(boss, db);
      // Only worth a line when something actually changed; otherwise this
      // would write five identical log entries an hour forever.
      if (result.added > 0 || result.removed > 0) {
        logger.info(result, "schedules changed");
      }
    }),
  );

  logger.info({ queue: SYNC_QUEUE }, "schedule sync worker registered");
}
