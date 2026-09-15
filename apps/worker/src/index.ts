import { createDb } from "@intentowl/db";

import { createAdapters } from "./adapters.ts";
import { createBoss } from "./boss.ts";
import { env } from "./env.ts";
import { startHttpServer } from "./http.ts";
import { registerJobs } from "./jobs/index.ts";
import { logger } from "./logger.ts";

/**
 * Worker boot: connect Postgres, start pg-boss, register jobs and schedules,
 * expose /healthz, then stay up.
 */
async function main(): Promise<void> {
  logger.info({ env: env.NODE_ENV }, "worker starting");

  const { pool, db } = createDb(env.DATABASE_URL);
  const boss = createBoss();
  await boss.start();
  logger.info("pg-boss started");

  await registerJobs(boss, db, createAdapters(db));

  const http = startHttpServer(db);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "worker shutting down");
    try {
      // Let in-flight jobs finish rather than orphaning them in active state.
      await boss.stop({ graceful: true, close: true, timeout: 30_000 });
      await http.close();
      await pool.end();
      logger.info("worker stopped cleanly");
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  logger.info("worker ready");
}

// A worker that cannot boot must die loudly, not linger half-alive.
main().catch((error: unknown) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
