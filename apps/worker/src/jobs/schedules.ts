/**
 * Cron registration (ARCHITECTURE.md sections 4.5 and 7).
 *
 * Turns rows in `watches` and `customers` into pg-boss schedules, so the
 * pipeline runs itself instead of waiting for someone to type a CLI command.
 *
 * Three things this has to get right:
 *
 * **Timezones.** The digest schedule carries the customer's IANA zone and the
 * local hour they asked for. pg-boss resolves the cron in that zone on every
 * firing, so a UK customer is sent at 06:00 UTC in September and 07:00 UTC in
 * November without anything being recomputed. Storing a UTC hour instead would
 * be a correct answer that silently stops being true on the last Sunday in
 * October.
 *
 * **Staggering.** Every schedule gets a minute offset derived from its own id,
 * so a hundred watches do not all wake on the stroke of the hour and a hundred
 * customers do not all send at 07:00:00.
 *
 * **Removal.** Syncing only adds is how a churned customer keeps receiving
 * email and a deleted watch keeps burning API quota. Anything present in
 * pg-boss but no longer wanted is unscheduled.
 */
import type { SourceName } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { logger } from "../logger.ts";
import { CLASSIFY_QUEUE, CLASSIFY_QUEUE_OPTIONS } from "./classify.ts";
import { DIGEST_QUEUE, DIGEST_QUEUE_OPTIONS } from "./digest.ts";
import { HARVEST_QUEUE, HARVEST_QUEUE_OPTIONS } from "./harvest-fewshots.ts";
import { OPS_REPORT_QUEUE, OPS_REPORT_QUEUE_OPTIONS } from "./ops-report.ts";
import { REFRESH_QUEUE, REFRESH_QUEUE_OPTIONS } from "./refresh-engagement.ts";
import { RETENTION_QUEUE, RETENTION_QUEUE_OPTIONS } from "./retention.ts";
import { SYNC_QUEUE, SYNC_QUEUE_OPTIONS } from "./sync-schedules.ts";
import { THREADS_TOKEN_QUEUE, THREADS_TOKEN_QUEUE_OPTIONS } from "./threads-token.ts";
import {
  POLL_QUEUE,
  POLL_QUEUE_OPTIONS,
  pollSingletonKey,
} from "./poll.ts";

/**
 * How often to poll each source, in minutes.
 *
 * Reddit and HN are the volume sources and move fastest. Stack Exchange is
 * hourly on purpose: its daily quota is shared across every customer, and at
 * twelve minutes a single watch cannot afford to search all of its terms.
 * Slowing it down is what makes full term coverage affordable.
 */
const POLL_INTERVAL_MINUTES: Record<SourceName, number> = {
  reddit: 12,
  hn: 15,
  lobsters: 20,
  stackexchange: 60,
  bluesky: 15,
  rss: 30,
  x: 30,
  // Hourly: every customer's searches share one 2,200-a-day Threads budget,
  // so a faster cadence only reaches the cap sooner.
  threads: 60,
};

/** Drains whatever the polls have queued up. */
const CLASSIFY_CRON = "*/5 * * * *";

/**
 * Daily ops report, 06:30 UTC — before the earliest customer digest goes out,
 * so a broken pipeline is visible while there is still time to fix it rather
 * than after the empty email has landed.
 */
const OPS_REPORT_CRON = "30 6 * * *";

/**
 * Rebuild few-shot examples hourly. Pure database work, no API calls, so the
 * only cost of running it often is that a customer's thumbs-up starts shaping
 * their results within the hour rather than the next day.
 */
const HARVEST_CRON = "40 * * * *";

/**
 * Engagement refresh every two hours, offset from the polls so it is not
 * competing with them for the same rate budget. Hourly would spend requests
 * re-reading counters that barely move; daily would miss the window where a
 * thread actually takes off.
 */
const REFRESH_CRON = "25 */2 * * *";

/**
 * Re-read the watches every ten minutes and reconcile the crons.
 *
 * Ten minutes is the worst case between a customer creating a search in the
 * dashboard and it starting to poll — short enough that nobody wonders whether
 * it worked, long enough that the reconcile is background noise.
 */
const SYNC_CRON = "*/10 * * * *";

/**
 * Daily check; the job itself only refreshes weekly. Daily so a failed refresh
 * is retried the next morning, long before a 60-day token runs out.
 */
const THREADS_TOKEN_CRON = "20 5 * * *";

/** Deletes Reddit posts past their 30-day retention, overnight. */
const RETENTION_CRON = "50 3 * * *";

export interface SyncResult {
  added: number;
  kept: number;
  removed: number;
}

/**
 * Reconcile pg-boss's schedules with the database.
 *
 * Idempotent: safe on every boot, and safe to call again after onboarding a
 * customer. `schedule()` is an upsert keyed on (queue, key).
 */
export async function syncSchedules(
  boss: PgBoss,
  db: Db,
): Promise<SyncResult> {
  // pg-boss refuses to schedule onto a queue that does not exist, and this
  // runs from the CLI as well as the worker — where nothing has registered a
  // handler yet. `createQueue` is an upsert, so doing it here is free and
  // makes onboarding work before a worker has ever booted.
  await ensureQueues(boss);

  const desired = await desiredSchedules(db);
  const existing = await boss.getSchedules();

  const wanted = new Map(desired.map((s) => [`${s.queue}::${s.key}`, s]));
  const seen = new Set<string>();
  const result: SyncResult = { added: 0, kept: 0, removed: 0 };

  for (const current of existing) {
    const id = `${current.name}::${current.key}`;
    // Only ever touch the queues this function owns; the heartbeat and any
    // future schedule registered elsewhere must survive a sync.
    if (!OWNED_QUEUES.has(current.name)) continue;
    seen.add(id);

    const want = wanted.get(id);
    if (want === undefined) {
      await boss.unschedule(current.name, current.key);
      result.removed += 1;
      logger.info(
        { queue: current.name, key: current.key },
        "schedule removed — no longer wanted",
      );
      continue;
    }
    if (want.cron === current.cron && want.tz === current.timezone) {
      result.kept += 1;
      continue;
    }
    // Cadence or timezone changed: re-upsert over the top.
    await boss.schedule(want.queue, want.cron, want.data, {
      key: want.key,
      tz: want.tz,
      ...(want.singletonKey === undefined ? {} : { singletonKey: want.singletonKey }),
    });
    result.added += 1;
  }

  for (const [id, want] of wanted) {
    if (seen.has(id)) continue;
    await boss.schedule(want.queue, want.cron, want.data, {
      key: want.key,
      tz: want.tz,
      ...(want.singletonKey === undefined ? {} : { singletonKey: want.singletonKey }),
    });
    result.added += 1;
  }

  logger.info(result, "schedules synced");
  return result;
}

const OWNED_QUEUES = new Set<string>([
  POLL_QUEUE,
  DIGEST_QUEUE,
  CLASSIFY_QUEUE,
  OPS_REPORT_QUEUE,
  HARVEST_QUEUE,
  REFRESH_QUEUE,
  SYNC_QUEUE,
  THREADS_TOKEN_QUEUE,
  RETENTION_QUEUE,
]);

/** Create every queue the scheduler targets. Idempotent; safe to repeat. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(POLL_QUEUE, POLL_QUEUE_OPTIONS);
  await boss.createQueue(CLASSIFY_QUEUE, CLASSIFY_QUEUE_OPTIONS);
  await boss.createQueue(DIGEST_QUEUE, DIGEST_QUEUE_OPTIONS);
  await boss.createQueue(OPS_REPORT_QUEUE, OPS_REPORT_QUEUE_OPTIONS);
  await boss.createQueue(HARVEST_QUEUE, HARVEST_QUEUE_OPTIONS);
  await boss.createQueue(REFRESH_QUEUE, REFRESH_QUEUE_OPTIONS);
  await boss.createQueue(SYNC_QUEUE, SYNC_QUEUE_OPTIONS);
  await boss.createQueue(THREADS_TOKEN_QUEUE, THREADS_TOKEN_QUEUE_OPTIONS);
  await boss.createQueue(RETENTION_QUEUE, RETENTION_QUEUE_OPTIONS);
}

interface DesiredSchedule {
  queue: string;
  key: string;
  cron: string;
  tz: string;
  data: Record<string, unknown> | null;
  singletonKey?: string;
}

async function desiredSchedules(db: Db): Promise<DesiredSchedule[]> {
  const out: DesiredSchedule[] = [
    // One classify schedule for the whole deployment: the job drains across
    // every watch, so a schedule per customer would just contend for the lock.
    { queue: CLASSIFY_QUEUE, key: "classify", cron: CLASSIFY_CRON, tz: "UTC", data: null },
    {
      queue: OPS_REPORT_QUEUE,
      key: "ops-report",
      cron: OPS_REPORT_CRON,
      tz: "UTC",
      data: null,
    },
    {
      queue: HARVEST_QUEUE,
      key: "harvest-fewshots",
      cron: HARVEST_CRON,
      tz: "UTC",
      data: null,
    },
    {
      queue: REFRESH_QUEUE,
      key: "refresh-engagement",
      cron: REFRESH_CRON,
      tz: "UTC",
      data: null,
    },
    {
      queue: SYNC_QUEUE,
      key: "sync-schedules",
      cron: SYNC_CRON,
      tz: "UTC",
      data: null,
    },
    {
      queue: THREADS_TOKEN_QUEUE,
      key: "refresh-threads-token",
      cron: THREADS_TOKEN_CRON,
      tz: "UTC",
      data: null,
    },
    {
      queue: RETENTION_QUEUE,
      key: "retention",
      cron: RETENTION_CRON,
      tz: "UTC",
      data: null,
    },
  ];

  const watches = await db
    .select({
      id: schema.watches.id,
      sources: schema.watches.sources,
      active: schema.watches.active,
      customerStatus: schema.customers.status,
    })
    .from(schema.watches)
    .innerJoin(schema.customers, eq(schema.customers.id, schema.watches.customerId));

  for (const watch of watches) {
    // A churned customer's watches must stop costing money the day they leave.
    if (!watch.active || watch.customerStatus === "churned") continue;

    for (const source of watch.sources) {
      const minutes = POLL_INTERVAL_MINUTES[source] ?? 15;
      out.push({
        queue: POLL_QUEUE,
        // Slash, not colon: pg-boss restricts schedule keys to alphanumerics,
        // underscore, hyphen, period and slash.
        key: `${watch.id}/${source}`,
        cron: intervalCron(minutes, offsetFor(`${watch.id}:${source}`, minutes)),
        tz: "UTC",
        data: { watchId: watch.id, source },
        singletonKey: pollSingletonKey({ watchId: watch.id, source }),
      });
    }
  }

  const customers = await db
    .select({
      id: schema.customers.id,
      tz: schema.customers.tz,
      digestHour: schema.customers.digestHour,
      status: schema.customers.status,
    })
    .from(schema.customers);

  for (const customer of customers) {
    // Only paying customers get a digest. A lead has no watches to digest and
    // a churned one must stop receiving email immediately.
    if (customer.status !== "active") continue;
    out.push({
      queue: DIGEST_QUEUE,
      key: `digest/${customer.id}`,
      // Minute offset so a hundred customers do not all send at :00.
      cron: `${offsetFor(customer.id, 60)} ${customer.digestHour} * * *`,
      // The whole point: pg-boss resolves this cron in the customer's zone on
      // every firing, so DST is handled without anything being recomputed.
      tz: customer.tz,
      data: { customerId: customer.id },
    });
  }

  return out;
}

/**
 * A cron firing every `minutes`, starting at `offset`.
 *
 * `7-59/20` means 07, 27, 47 — a real stagger, not every watch on the hour.
 * Intervals that do not divide 60 would drift across the hour boundary, so
 * anything above 60 minutes becomes a plain hourly schedule at the offset.
 */
export function intervalCron(minutes: number, offset: number): string {
  if (minutes >= 60) return `${offset % 60} * * * *`;
  const start = offset % minutes;
  return `${start}-59/${minutes} * * * *`;
}

/** Stable minute offset from an id. Same input, same slot, every boot. */
export function offsetFor(id: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % Math.max(1, modulo);
}
