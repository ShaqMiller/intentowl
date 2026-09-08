/**
 * Concierge-phase ops CLI (ARCHITECTURE.md sections 3 and 4.6).
 *
 * In the concierge phase there is no settings UI — these commands are the admin
 * interface, and the v1 dashboard eventually replaces them.
 *
 * Commands land with the milestone that makes them meaningful:
 *   M1  run-poll --watch=<id> [--source=reddit|hn] [--dry-run]
 *   M3  send-digest --customer=<id> [--dry-run]
 *   M4  seed --file=<customer.json>
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { sourceName, type SourceName } from "@intentowl/core";
import { createDb, schema } from "@intentowl/db";
import { eq, sql } from "drizzle-orm";

import { createAdapters } from "./adapters.ts";
import { createBoss } from "./boss.ts";
import { startBatchRun } from "./jobs/classify-batch.ts";
import { env } from "./env.ts";
import { runDigest } from "./jobs/digest.ts";
import { runHarvest } from "./jobs/harvest-fewshots.ts";
import { runOpsReport } from "./jobs/ops-report.ts";
import { runRefreshEngagement } from "./jobs/refresh-engagement.ts";
import { syncSchedules } from "./jobs/schedules.ts";
import { applySeed, parseSeedFile } from "./seed.ts";
import { runPoll } from "./jobs/poll.ts";
import { logger } from "./logger.ts";

const USAGE = `intentowl cli

  ping
      Check the database connection.

  run-poll --watch=<id> [--source=<name>] [--dry-run]
      Fetch new items for one watch. Omit --source to poll every source
      configured on the watch. --dry-run fetches but writes nothing.

  classify-batch
      Submit the pending backlog through the Batch API at 50% off. Returns
      immediately; the worker polls and collects. Requires a running worker.

  send-digest --customer=<id> [--dry-run] [--force]
      Build today's digest. --dry-run renders it to docs/digest-preview.html
      and sends nothing. Without it, the digest is recorded and emailed, once
      per customer per local day unless --force.

  seed --file=<customer.json>
      Onboard or update a customer from a JSON file. Idempotent by email.
      Re-syncs the cron schedules afterwards.

  schedules
      Print the cron schedules currently registered.

  ops-report
      Build the daily pipeline report and send it to the ops Slack webhook.
      Runs on cron at 06:30 UTC; this is the on-demand version.

  harvest-fewshots
      Rebuild every customer's calibration examples from their feedback.
      Runs hourly on cron; this is the on-demand version.

  refresh-engagement
      Re-read points and comment counts for recent items, so a thread that
      took off after we found it is ranked on what it became.
`;

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  switch (command) {
    case "ping":
      return await ping();

    case "run-poll":
      return await runPollCommand(flags);

    case "classify-batch":
      return await classifyBatchCommand();

    case "send-digest":
      return await sendDigestCommand(flags);

    case "seed":
      return await seedCommand(flags);

    case "schedules":
      return await schedulesCommand();

    case "ops-report":
      return await opsReportCommand();

    case "harvest-fewshots":
      return await harvestCommand();

    case "refresh-engagement":
      return await refreshEngagementCommand();

    default:
      process.stdout.write(USAGE);
      return command === undefined || command === "help" ? 0 : 1;
  }
}

async function refreshEngagementCommand(): Promise<number> {
  const { pool, db } = createDb(env.DATABASE_URL);
  try {
    const outcomes = await runRefreshEngagement(db, createAdapters());
    process.stdout.write(`${JSON.stringify(outcomes, null, 2)}
`);
    return 0;
  } finally {
    await pool.end();
  }
}

async function harvestCommand(): Promise<number> {
  const { pool, db } = createDb(env.DATABASE_URL);
  try {
    const outcomes = await runHarvest(db);
    process.stdout.write(`${JSON.stringify(outcomes, null, 2)}
`);
    return 0;
  } finally {
    await pool.end();
  }
}

async function opsReportCommand(): Promise<number> {
  const { pool, db } = createDb(env.DATABASE_URL);
  try {
    const report = await runOpsReport(db);
    // Print the raw numbers too: Slack formatting hides precision, and this is
    // the command you run when you already suspect something is wrong.
    process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
    return 0;
  } finally {
    await pool.end();
  }
}

async function ping(): Promise<number> {
  const { pool, db } = createDb(env.DATABASE_URL);
  try {
    const result = await db.execute<{ now: Date }>(sql`select now() as now`);
    logger.info({ db_time: result.rows[0]?.now ?? null }, "database ok");
    return 0;
  } finally {
    await pool.end();
  }
}

async function classifyBatchCommand(): Promise<number> {
  const boss = createBoss();
  try {
    await boss.start();
    const id = await startBatchRun(boss);
    if (id === null) {
      // The queue is stately, so a run already in flight is not an error.
      process.stdout.write("a batch run is already queued or active\n");
      return 0;
    }
    process.stdout.write(
      `batch run queued (job ${id}). The worker submits, polls and collects; ` +
        `watch its logs for "batch collected".\n`,
    );
    return 0;
  } finally {
    await boss.stop({ graceful: true, close: true, timeout: 10_000 });
  }
}

async function seedCommand(flags: Flags): Promise<number> {
  const file = flags.string("file");
  if (file === undefined) {
    process.stderr.write("seed requires --file=<customer.json>\n");
    return 1;
  }

  // Validate before opening a connection: a bad file should fail without
  // leaving a half-onboarded customer behind.
  const seed = parseSeedFile(file);

  const { pool, db } = createDb(env.DATABASE_URL);
  const boss = createBoss();
  try {
    const result = await applySeed(db, seed);
    process.stdout.write(
      `${result.created ? "created" : "updated"} ${result.email} (${result.customerId})
` +
        `${result.watchIds.length} watch(es)
`,
    );

    // Schedules are derived from these rows, so onboarding is not finished
    // until they exist — otherwise the customer is in the database and nothing
    // ever polls or sends for them.
    await boss.start();
    const sync = await syncSchedules(boss, db);
    process.stdout.write(
      `schedules: +${sync.added} kept ${sync.kept} -${sync.removed}
`,
    );
    return 0;
  } finally {
    await boss.stop({ graceful: true, close: true, timeout: 10_000 });
    await pool.end();
  }
}

async function schedulesCommand(): Promise<number> {
  const boss = createBoss();
  try {
    await boss.start();
    const schedules = await boss.getSchedules();
    if (schedules.length === 0) {
      process.stdout.write("no schedules registered\n");
      return 0;
    }
    for (const s of [...schedules].sort((a, b) => a.name.localeCompare(b.name))) {
      process.stdout.write(
        `${s.name.padEnd(16)} ${String(s.cron).padEnd(18)} ${String(s.timezone).padEnd(18)} ${s.key}
`,
      );
    }
    return 0;
  } finally {
    await boss.stop({ graceful: true, close: true, timeout: 10_000 });
  }
}

async function sendDigestCommand(flags: Flags): Promise<number> {
  const customerId = flags.string("customer");
  if (customerId === undefined) {
    process.stderr.write("send-digest requires --customer=<id>\n");
    return 1;
  }

  const dryRun = flags.boolean("dry-run");
  const { pool, db } = createDb(env.DATABASE_URL);
  try {
    const outcome = await runDigest({
      db,
      customerId,
      dryRun,
      ...(flags.boolean("force") ? { force: true } : {}),
    });

    if (outcome.skipped) {
      process.stdout.write(
        "already sent today for this customer's local day; use --force to override\n",
      );
      return 0;
    }

    process.stdout.write(
      `leads ${outcome.leadCount}` +
        `${outcome.degraded ? "  [degraded]" : ""}` +
        `  subject: ${outcome.subject ?? "(none)"}\n`,
    );

    if (dryRun && outcome.html !== undefined) {
      // Written to disk rather than opened, so it can be diffed between runs
      // and looked at in a real browser — email HTML lies in a terminal.
      const target = fileURLToPath(
        new URL("../../../docs/digest-preview.html", import.meta.url),
      );
      writeFileSync(target, outcome.html);
      process.stdout.write(`preview written to ${target}\n`);
      return 0;
    }

    if (outcome.error !== undefined) {
      process.stderr.write(`${outcome.error}\n`);
      return 1;
    }
    process.stdout.write(outcome.sent ? "sent\n" : "recorded but not sent\n");
    return outcome.sent ? 0 : 1;
  } finally {
    await pool.end();
  }
}

async function runPollCommand(flags: Flags): Promise<number> {
  const watchId = flags.string("watch");
  if (watchId === undefined) {
    process.stderr.write("run-poll requires --watch=<id>\n");
    return 1;
  }

  const { pool, db } = createDb(env.DATABASE_URL);
  try {
    const sources = await resolveSources(db, watchId, flags.string("source"));
    if (sources.length === 0) {
      process.stderr.write(
        `watch ${watchId} has no sources configured; set watches.sources first\n`,
      );
      return 1;
    }

    const adapters = createAdapters();
    const dryRun = flags.boolean("dry-run");
    let failed = false;

    for (const source of sources) {
      try {
        const outcome = await runPoll({
          db,
          adapters,
          watchId,
          source,
          persist: !dryRun,
        });
        process.stdout.write(
          `${source.padEnd(8)} fetched ${String(outcome.fetched).padStart(4)}` +
            `  new ${String(outcome.inserted).padStart(4)}` +
            `  duplicate ${String(outcome.duplicates).padStart(4)}` +
            `  linked ${String(outcome.linked).padStart(4)}` +
            `  calls ${outcome.calls}` +
            `${outcome.rateLimited ? "  [rate limited]" : ""}` +
            `${dryRun ? "  [dry run]" : ""}\n`,
        );
      } catch (error) {
        failed = true;
        logger.error({ err: error, source }, "poll failed");
      }
    }

    return failed ? 1 : 0;
  } finally {
    await pool.end();
  }
}

/** Use --source if given, otherwise every source listed on the watch. */
async function resolveSources(
  db: ReturnType<typeof createDb>["db"],
  watchId: string,
  requested: string | undefined,
): Promise<SourceName[]> {
  if (requested !== undefined) {
    const parsed = sourceName.safeParse(requested);
    if (!parsed.success) {
      throw new Error(
        `unknown source "${requested}"; expected one of ${sourceName.options.join(", ")}`,
      );
    }
    return [parsed.data];
  }

  const rows = await db
    .select({ sources: schema.watches.sources })
    .from(schema.watches)
    .where(eq(schema.watches.id, watchId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error(`watch ${watchId} not found`);
  return row.sources;
}

// --- flag parsing -----------------------------------------------------------

interface Flags {
  string(name: string): string | undefined;
  boolean(name: string): boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const values = new Map<string, string | true>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) values.set(body, true);
    else values.set(body.slice(0, eq), body.slice(eq + 1));
  }
  return {
    string(name) {
      const value = values.get(name);
      return typeof value === "string" && value !== "" ? value : undefined;
    },
    boolean(name) {
      return values.has(name);
    },
  };
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    logger.error({ err: error }, "cli failed");
    process.exit(1);
  });
