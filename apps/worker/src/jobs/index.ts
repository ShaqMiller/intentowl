import type { PgBoss } from "pg-boss";

import type { Db } from "@intentowl/db";

import { registerHeartbeat } from "./heartbeat.ts";

/**
 * Every job the worker runs is registered here.
 *
 * Registration must be idempotent — `createQueue`, `work` and `schedule` are
 * all upserts — because the worker re-registers on every boot and Railway
 * restarts it freely.
 *
 * M1 adds poll, M2 classify, M3 digest, M4 the per-customer digest crons,
 * M6 engagement-refresh and ops-daily (ARCHITECTURE.md section 7).
 */
export async function registerJobs(boss: PgBoss, db: Db): Promise<void> {
  await registerHeartbeat(boss, db);
}

export { HEARTBEAT_QUEUE } from "./heartbeat.ts";
