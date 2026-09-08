import type { PgBoss } from "pg-boss";

import type { Db } from "@intentowl/db";

import { registerClassifyBatch } from "./classify-batch.ts";
import {
  createAnthropicClient,
  createWorkerClassifier,
  registerClassify,
} from "./classify.ts";
import { registerDigest } from "./digest.ts";
import { registerHarvest } from "./harvest-fewshots.ts";
import { registerHeartbeat } from "./heartbeat.ts";
import { registerOpsReport } from "./ops-report.ts";
import { registerPoll, type AdapterRegistry } from "./poll.ts";
import { registerRefreshEngagement } from "./refresh-engagement.ts";
import { syncSchedules } from "./schedules.ts";

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
  await registerClassifyBatch(boss, db, createAnthropicClient());
  await registerDigest(boss, db);
  await registerOpsReport(boss, db);
  await registerHarvest(boss, db);
  await registerRefreshEngagement(boss, db, adapters);

  // Last: the queues have to exist before anything can be scheduled onto them.
  await syncSchedules(boss, db);
}

export { HEARTBEAT_QUEUE } from "./heartbeat.ts";
export {
  REFRESH_QUEUE,
  runRefreshEngagement,
  type RefreshOutcome,
} from "./refresh-engagement.ts";
export {
  HARVEST_QUEUE,
  harvestForCustomer,
  runHarvest,
  type HarvestOutcome,
} from "./harvest-fewshots.ts";
export {
  OPS_REPORT_QUEUE,
  buildOpsReport,
  describeReport,
  runOpsReport,
  type OpsReport,
} from "./ops-report.ts";
export { syncSchedules, intervalCron, offsetFor } from "./schedules.ts";
export {
  DIGEST_QUEUE,
  runDigest,
  localDayFor,
  dateLabelFor,
  type DigestOutcome,
} from "./digest.ts";
export {
  CLASSIFY_BATCH_QUEUE,
  startBatchRun,
  type ClassifyBatchData,
} from "./classify-batch.ts";
export {
  CLASSIFY_QUEUE,
  createAnthropicClient,
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
