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
import { sourceName, type SourceName } from "@intentowl/core";
import { createDb, schema } from "@intentowl/db";
import { eq, sql } from "drizzle-orm";

import { createAdapters } from "./adapters.ts";
import { createBoss } from "./boss.ts";
import { startBatchRun } from "./jobs/classify-batch.ts";
import { env } from "./env.ts";
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

  send-digest --customer=<id> [--dry-run]      (M3)
  seed --file=<customer.json>                  (M4)
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
    case "seed":
      process.stderr.write(
        `"${command}" is not implemented yet — see the milestone map in ${import.meta.filename}.\n`,
      );
      return 1;

    default:
      process.stdout.write(USAGE);
      return command === undefined || command === "help" ? 0 : 1;
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
