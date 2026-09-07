import type { PgBoss } from "pg-boss";

import type { Db } from "@intentowl/db";

import { registerHeartbeat } from "./heartbeat.ts";
import { registerPoll, type AdapterRegistry } from "./poll.ts";

/**
 * Every job the worker runs is registered here.
 *
 * Registration must be idempotent — `createQueue`, `work` and `schedule` are
 * all upserts — because the worker re-registers on every boot and Railway
 * restarts it freely.
 *
 * M2 adds classify, M3 digest, M4 the per-watch poll crons and per-customer
 * digest crons, M6 engagement-refresh and ops-daily (ARCHITECTURE.md § 7).
 */
export async function registerJobs(
  boss: PgBoss,
  db: Db,
  adapters: AdapterRegistry,
): Promise<void> {
  await registerHeartbeat(boss, db);
  await registerPoll(boss, db, adapters);
}

export { HEARTBEAT_QUEUE } from "./heartbeat.ts";
export {
  POLL_QUEUE,
  pollSingletonKey,
  runPoll,
  type AdapterRegistry,
  type PollJobData,
  type PollOutcome,
} from "./poll.ts";
