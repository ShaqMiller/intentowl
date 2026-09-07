import type { PgBoss } from "pg-boss";

import type { Db } from "@intentowl/db";

import { registerClassify, createWorkerClassifier } from "./classify.ts";
import { registerHeartbeat } from "./heartbeat.ts";
import { registerPoll, type AdapterRegistry } from "./poll.ts";

/**
 * Every job the worker runs is registered here.
 *
 * Registration must be idempotent — `createQueue`, `work` and `schedule` are
 * all upserts — because the worker re-registers on every boot and Railway
 * restarts it freely.
 *
 * M3 adds digest, M4 the per-watch poll crons and per-customer digest crons,
 * M6 engagement-refresh and ops-daily (ARCHITECTURE.md § 7).
 */
export async function registerJobs(
  boss: PgBoss,
  db: Db,
  adapters: AdapterRegistry,
): Promise<void> {
  await registerHeartbeat(boss, db);
  await registerPoll(boss, db, adapters);
  await registerClassify(boss, db, createWorkerClassifier());
}

export { HEARTBEAT_QUEUE } from "./heartbeat.ts";
export {
  CLASSIFY_QUEUE,
  createWorkerClassifier,
  runClassify,
  type ClassifyOutcome,
} from "./classify.ts";
export {
  POLL_QUEUE,
  pollSingletonKey,
  runPoll,
  type AdapterRegistry,
  type PollJobData,
  type PollOutcome,
} from "./poll.ts";
