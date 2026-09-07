import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Db } from "@intentowl/db";

import { env } from "./env.ts";
import { logger } from "./logger.ts";

/**
 * Incidental HTTP: a health endpoint for Railway to ping (ARCHITECTURE.md
 * section 4.9). Deliberately ~30 lines — the worker's architecture is cron and
 * queue, not request/response, and nothing else belongs here.
 */
export function startHttpServer(db: Db): { close: () => Promise<void> } {
  const app = new Hono();

  app.get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ status: "ok" });
    } catch (error) {
      logger.error({ err: error }, "healthz database check failed");
      return c.json({ status: "degraded", database: "unreachable" }, 503);
    }
  });

  const server = serve({ fetch: app.fetch, port: env.PORT });
  logger.info({ port: env.PORT }, "health endpoint listening");

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
