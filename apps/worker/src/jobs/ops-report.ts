/**
 * Daily operations report (ARCHITECTURE.md sections 7 and 10).
 *
 * Answers one question every morning: did the pipeline actually work
 * yesterday? Everything here is measured, never inferred — if a number cannot
 * be read from a table it is not reported, because a made-up denominator in an
 * ops report is worse than a missing one.
 *
 * The report deliberately includes the pass-through rates as well as the
 * totals. "412 items fetched" looks healthy on a day when the pre-filter
 * rejected all 412, and that failure is invisible in the totals alone.
 */
import { schema, type Db } from "@intentowl/db";
import { and, count, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { logger } from "../logger.ts";
import { notifyOps, withOpsAlert } from "../ops.ts";

export const OPS_REPORT_QUEUE = "ops-report";

export const OPS_REPORT_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 300,
} as const;

export interface OpsReport {
  windowHours: number;
  itemsFetched: number;
  pairsCreated: number;
  pairsFiltered: number;
  pairsClassified: number;
  pairsPending: number;
  relevant: number;
  digestsSent: number;
  digestLeads: number;
  failedJobs: number;
  costUsd: number;
  activeCustomers: number;
  activeWatches: number;
  /** Sources that produced nothing at all in the window. */
  silentSources: string[];
}

const WINDOW_HOURS = 24;

export async function buildOpsReport(
  db: Db,
  now: Date = new Date(),
): Promise<OpsReport> {
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);

  const [
    itemsFetched,
    pairsCreated,
    pairsFiltered,
    pairsClassified,
    relevant,
    digests,
    cost,
    activeCustomers,
    activeWatches,
    perSource,
    failedJobs,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(schema.items)
      .where(gte(schema.items.fetchedAt, since)),
    db
      .select({ n: count() })
      .from(schema.itemWatches)
      .where(gte(schema.itemWatches.createdAt, since)),
    db
      .select({ n: count() })
      .from(schema.itemWatches)
      .where(
        and(
          gte(schema.itemWatches.createdAt, since),
          isNotNull(schema.itemWatches.filteredAt),
        ),
      ),
    db
      .select({ n: count(sql`distinct (${schema.classifications.itemId}, ${schema.classifications.watchId})`) })
      .from(schema.classifications)
      .where(gte(schema.classifications.createdAt, since)),
    db
      .select({ n: count(sql`distinct ${schema.classifications.itemId}`) })
      .from(schema.classifications)
      .where(
        and(
          gte(schema.classifications.createdAt, since),
          eq(schema.classifications.relevant, true),
        ),
      ),
    db
      .select({
        n: count(),
        leads: sql<number>`coalesce(sum(${schema.digests.itemCount}), 0)`,
      })
      .from(schema.digests)
      .where(gte(schema.digests.sentAt, since)),
    db
      .select({
        usd: sql<string>`coalesce(sum(${schema.apiUsage.costUsd}), 0)`,
      })
      .from(schema.apiUsage)
      .where(gte(schema.apiUsage.day, isoDay(since))),
    db
      .select({ n: count() })
      .from(schema.customers)
      .where(eq(schema.customers.status, "active")),
    db
      .select({ n: count() })
      .from(schema.watches)
      .where(eq(schema.watches.active, true)),
    db
      .select({ source: schema.items.source, n: count() })
      .from(schema.items)
      .where(gte(schema.items.fetchedAt, since))
      .groupBy(schema.items.source),
    // pg-boss keeps its own job table; failures there are the single best
    // signal that something is wrong and nobody noticed.
    db.execute(
      sql`select count(*)::int as n from pgboss.job where state = 'failed' and created_on >= ${since.toISOString()}`,
    ),
  ]);

  // Undecided pairs: created but neither filtered nor classified. A number
  // that climbs day over day is the starvation bug coming back.
  const pending = await db
    .select({ n: count() })
    .from(schema.itemWatches)
    .where(isNull(schema.itemWatches.filteredAt));

  const seen = new Set(perSource.map((r) => r.source));
  const configured = await db
    .select({ sources: schema.watches.sources })
    .from(schema.watches)
    .where(eq(schema.watches.active, true));
  const expected = new Set(configured.flatMap((w) => w.sources));
  const silentSources = [...expected].filter((s) => !seen.has(s)).sort();

  return {
    windowHours: WINDOW_HOURS,
    itemsFetched: num(itemsFetched[0]?.n),
    pairsCreated: num(pairsCreated[0]?.n),
    pairsFiltered: num(pairsFiltered[0]?.n),
    pairsClassified: num(pairsClassified[0]?.n),
    pairsPending: num(pending[0]?.n),
    relevant: num(relevant[0]?.n),
    digestsSent: num(digests[0]?.n),
    digestLeads: num(digests[0]?.leads),
    failedJobs: readCount(failedJobs),
    costUsd: Number(cost[0]?.usd ?? 0),
    activeCustomers: num(activeCustomers[0]?.n),
    activeWatches: num(activeWatches[0]?.n),
    silentSources,
  };
}

/**
 * Turn the report into operator-readable lines, and decide how loud to be.
 *
 * The level is derived from the numbers rather than set by the caller: a
 * report nobody reads is the same as no report, so a bad day has to look
 * different from a good one at a glance.
 */
export function describeReport(report: OpsReport): {
  level: "info" | "warn" | "error";
  title: string;
  lines: string[];
} {
  const pct = (n: number, d: number): string =>
    d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;

  const lines = [
    `Fetched *${report.itemsFetched}* items into *${report.pairsCreated}* watch pairs`,
    `Pre-filter dropped *${report.pairsFiltered}* (${pct(report.pairsFiltered, report.pairsCreated)}), classified *${report.pairsClassified}*`,
    `Relevant: *${report.relevant}* (${pct(report.relevant, report.pairsClassified)} of classified)`,
    `Digests sent: *${report.digestsSent}* carrying *${report.digestLeads}* leads`,
    `Claude spend today: *$${report.costUsd.toFixed(4)}*`,
    `Active: ${report.activeCustomers} customers, ${report.activeWatches} watches`,
  ];

  const problems: string[] = [];
  if (report.failedJobs > 0) {
    problems.push(`*${report.failedJobs}* failed jobs in the last 24h`);
  }
  if (report.silentSources.length > 0) {
    problems.push(
      `Silent sources: *${report.silentSources.join(", ")}* — configured on an active watch but returned nothing`,
    );
  }
  if (report.itemsFetched === 0) {
    problems.push("*No items fetched at all* — the pollers are not running");
  }
  // Not proof of the starvation bug, but the shape it makes when it returns.
  if (report.pairsPending > 5_000) {
    problems.push(
      `*${report.pairsPending}* undecided pairs are backed up — the classify queue may be starving`,
    );
  }
  if (report.digestsSent === 0 && report.activeCustomers > 0) {
    problems.push("*No digests sent* despite having active customers");
  }
  // A day with no leads is normal and the digest says so. A day where the
  // classifier read hundreds of posts and liked almost none of them is a
  // different thing: usually the profile or the include terms are wrong, and
  // it is invisible in the totals because everything "ran successfully".
  // Only meaningful once the sample is big enough to not be noise.
  if (report.pairsClassified >= 100 && report.relevant / report.pairsClassified < 0.02) {
    problems.push(
      `Yield is *${((report.relevant / report.pairsClassified) * 100).toFixed(1)}%* ` +
        `(${report.relevant} of ${report.pairsClassified}) — the search terms are ` +
        `catching the wrong posts, or the profile is too narrow`,
    );
  }

  const level =
    report.itemsFetched === 0 || report.failedJobs > 0 || problems.length > 1
      ? "error"
      : problems.length > 0
        ? "warn"
        : "info";

  return {
    level,
    title:
      problems.length === 0
        ? "IntentOwl daily report — pipeline healthy"
        : "IntentOwl daily report — needs attention",
    lines: [...problems, ...lines],
  };
}

export async function runOpsReport(db: Db, now: Date = new Date()): Promise<OpsReport> {
  const report = await buildOpsReport(db, now);
  const described = describeReport(report);
  await notifyOps(described);
  return report;
}

export async function registerOpsReport(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(OPS_REPORT_QUEUE, OPS_REPORT_QUEUE_OPTIONS);

  await boss.work(
    OPS_REPORT_QUEUE,
    { batchSize: 1 },
    withOpsAlert(OPS_REPORT_QUEUE, async () => {
      await runOpsReport(db);
    }),
  );

  logger.info({ queue: OPS_REPORT_QUEUE }, "ops report worker registered");
}

// --- helpers ----------------------------------------------------------------

function num(value: unknown): number {
  return Number(value ?? 0);
}

/** `db.execute` shape differs across drivers; read the count defensively. */
function readCount(result: unknown): number {
  const rows =
    Array.isArray(result) ? result : (result as { rows?: unknown[] })?.rows ?? [];
  const first = rows[0] as { n?: unknown } | undefined;
  return Number(first?.n ?? 0);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
