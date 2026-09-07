/**
 * Concierge-phase ops CLI (ARCHITECTURE.md section 3 and 4.6).
 *
 * In the concierge phase there is no settings UI — these commands are the admin
 * interface, and the v1 dashboard eventually replaces them.
 *
 * Commands land with the milestone that makes them meaningful:
 *   M1  run-poll --watch=<id>
 *   M3  send-digest --customer=<id> [--dry-run]
 *   M4  seed --file=<customer.json>
 */
import { createDb } from "@intentowl/db";
import { sql } from "drizzle-orm";

import { env } from "./env.ts";
import { logger } from "./logger.ts";

const USAGE = `intentowl cli

  ping                                     check the database connection
  run-poll     --watch=<id>                (M1)
  send-digest  --customer=<id> [--dry-run] (M3)
  seed         --file=<customer.json>      (M4)
`;

async function main(): Promise<number> {
  const [command] = process.argv.slice(2);

  switch (command) {
    case "ping": {
      const { pool, db } = createDb(env.DATABASE_URL);
      try {
        const result = await db.execute<{ now: Date }>(
          sql`select now() as now`,
        );
        logger.info({ db_time: result.rows[0]?.now ?? null }, "database ok");
        return 0;
      } finally {
        await pool.end();
      }
    }

    case "run-poll":
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

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    logger.error({ err: error }, "cli failed");
    process.exit(1);
  });
