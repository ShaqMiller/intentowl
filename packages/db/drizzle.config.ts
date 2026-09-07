import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

// One .env at the repo root serves every workspace. Node's built-in loader
// keeps this dependency-free; existing process env always wins.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// drizzle-kit is a CLI, not app code, so it reads DATABASE_URL directly rather
// than through an app's Zod env module. `generate` is offline codegen and needs
// no connection; `migrate` and `studio` fail loudly on an empty url.
const url = process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  dbCredentials: { url },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
