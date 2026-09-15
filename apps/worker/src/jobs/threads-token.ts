/**
 * Keeps the Threads access token alive.
 *
 * A long-lived Threads token lasts 60 days and can be refreshed once it is at
 * least a day old — but only while it is still valid. Miss the window and the
 * token is dead for good; someone has to re-authorise in Meta's dashboard. A
 * source that quietly dies two months after launch is exactly the failure this
 * product cannot afford, so the refresh is a job, not a calendar reminder.
 *
 * Weekly, from a daily cron: plenty of margin inside 60 days, and each daily
 * run that finds nothing to do costs one query.
 */
import { createHash } from "node:crypto";

import { fetchJson } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { withOpsAlert } from "../ops.ts";

export const THREADS_TOKEN_QUEUE = "refresh-threads-token";

export const THREADS_TOKEN_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 120,
} as const;

const REFRESH_URL = "https://graph.threads.net/refresh_access_token";
const DAY_MS = 86_400_000;
const REFRESH_EVERY_MS = 7 * DAY_MS;

const refreshResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string().nullish(),
  expires_in: z.number().int().positive(),
});

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The token a poll should use: the stored, refreshed one when it descends from
 * the token currently in env, otherwise the env token itself.
 */
export async function currentThreadsToken(db: Db, envToken: string): Promise<string> {
  const [row] = await db
    .select({ accessToken: schema.sourceTokens.accessToken, seed: schema.sourceTokens.seedFingerprint })
    .from(schema.sourceTokens)
    .where(eq(schema.sourceTokens.source, "threads"));
  return row !== undefined && row.seed === fingerprint(envToken) ? row.accessToken : envToken;
}

export interface ThreadsTokenOutcome {
  refreshed: boolean;
  expiresAt: Date | null;
  note: string;
}

export async function refreshThreadsToken(
  db: Db,
  envToken: string,
  now: Date = new Date(),
): Promise<ThreadsTokenOutcome> {
  const seed = fingerprint(envToken);
  const [existing] = await db
    .select()
    .from(schema.sourceTokens)
    .where(eq(schema.sourceTokens.source, "threads"));

  // A token never seen before — first boot, or a new one pasted into env. Its
  // age is unknown, so try to refresh it straight away.
  const seeded = existing === undefined || existing.seedFingerprint !== seed;
  const row = seeded
    ? { accessToken: envToken, seedFingerprint: seed, expiresAt: null, refreshedAt: new Date(0) }
    : existing;

  if (seeded) {
    await db
      .insert(schema.sourceTokens)
      .values({ source: "threads", ...row })
      .onConflictDoUpdate({ target: schema.sourceTokens.source, set: row });
  }

  if (now.getTime() - row.refreshedAt.getTime() < REFRESH_EVERY_MS) {
    return { refreshed: false, expiresAt: row.expiresAt, note: "refreshed within the last week" };
  }

  const url = `${REFRESH_URL}?${new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: row.accessToken,
  }).toString()}`;

  try {
    const result = await fetchJson({ source: "threads", url }, refreshResponse);
    const expiresAt = new Date(now.getTime() + result.expires_in * 1000);
    await db
      .update(schema.sourceTokens)
      .set({ accessToken: result.access_token, expiresAt, refreshedAt: now })
      .where(eq(schema.sourceTokens.source, "threads"));
    return { refreshed: true, expiresAt, note: "refreshed" };
  } catch (error) {
    if (seeded) {
      // Meta refuses to refresh a token under a day old, which is the normal
      // state of one just pasted in. Retry tomorrow instead of alerting.
      await db
        .update(schema.sourceTokens)
        .set({ refreshedAt: new Date(now.getTime() - REFRESH_EVERY_MS + DAY_MS) })
        .where(eq(schema.sourceTokens.source, "threads"));
      return { refreshed: false, expiresAt: null, note: "new token not refreshable yet; retrying tomorrow" };
    }
    // An established token that will not refresh is on its way to dying. Fail
    // the job so the ops alert fires while there is still time to re-authorise.
    throw error;
  }
}

export async function registerThreadsToken(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(THREADS_TOKEN_QUEUE, THREADS_TOKEN_QUEUE_OPTIONS);

  await boss.work(
    THREADS_TOKEN_QUEUE,
    { batchSize: 1 },
    withOpsAlert(THREADS_TOKEN_QUEUE, async () => {
      const token = env.THREADS_ACCESS_TOKEN;
      if (token === undefined) return;
      const outcome = await refreshThreadsToken(db, token);
      logger.info(outcome, "threads token check");
    }),
  );

  logger.info({ queue: THREADS_TOKEN_QUEUE }, "threads token worker registered");
}
