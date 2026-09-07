/**
 * Shared env plumbing.
 *
 * Each app owns its own Zod schema (apps/*&#47;src/env.ts) because the web app and
 * the worker need different subsets. What is shared is the loading of the one
 * repo-root .env and the crash-loud-at-boot parse, per ARCHITECTURE.md section
 * 10: a misconfigured worker must die at startup, not silently skip a 7am send.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { z } from "zod";

let loaded = false;

/**
 * Load the repo-root .env into process.env, once per process.
 * Variables already present in the real environment (Railway, Vercel, CI)
 * take precedence, so this is a no-op in deployed environments.
 */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}

/**
 * Parse process.env against a schema, or exit(1) with a readable report of
 * every missing/invalid variable. Never logs the values themselves.
 */
export function parseEnv<T extends z.ZodType>(schema: T): z.infer<T> {
  loadRootEnv();

  // `FOO=` in a .env file means "not configured", the same as an absent var —
  // otherwise every commented-out placeholder in .env.example would fail an
  // `.optional()` check and defaults would never apply.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== ""),
  );

  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    console.error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\nSee .env.example.`,
    );
    process.exit(1);
  }
  return result.data;
}
