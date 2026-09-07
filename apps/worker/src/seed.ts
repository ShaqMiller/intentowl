/**
 * Customer onboarding from a JSON file (ARCHITECTURE.md sections 4.6 and 8).
 *
 * In the concierge phase this is the whole signup flow: the customer fills in a
 * form, you paste the answers into a file, and this writes the rows. The v1
 * onboarding wizard eventually writes exactly the same rows — which is why this
 * takes the shape of the data rather than a sequence of prompts.
 *
 * Idempotent by email: running it twice updates rather than duplicating, so a
 * seed file is a description of a customer rather than a one-shot command.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sourceName } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, eq, notInArray } from "drizzle-orm";
import { z } from "zod";

export const seedFileSchema = z.object({
  customer: z.object({
    email: z.email(),
    name: z.string().min(1),
    /** IANA zone. Validated against the runtime so a typo fails here. */
    tz: z.string().default("UTC"),
    digestHour: z.number().int().min(0).max(23).default(7),
    status: z.enum(["lead", "active", "churned"]).default("active"),
    plan: z.string().optional(),
  }),
  profile: z.object({
    productDesc: z.string().min(1),
    icpDesc: z.string().min(1),
    competitors: z.array(z.string()).default([]),
    disqualifiers: z.array(z.string()).default([]),
  }),
  watches: z
    .array(
      z.object({
        name: z.string().min(1),
        sources: z.array(sourceName).min(1),
        subreddits: z.array(z.string()).default([]),
        includeTerms: z.array(z.string()).default([]),
        excludeTerms: z.array(z.string()).default([]),
        sourceConfig: z.record(z.string(), z.unknown()).optional(),
        active: z.boolean().default(true),
      }),
    )
    .min(1),
});

export type SeedFile = z.infer<typeof seedFileSchema>;

/**
 * Resolve a seed path the way a person expects it to resolve.
 *
 * pnpm runs the CLI from apps/worker, so a path typed at the repo root would
 * otherwise not be found. Try the working directory first, then the repo root,
 * before giving up.
 */
export function resolveSeedPath(path: string): string {
  if (isAbsolute(path) || existsSync(path)) return path;
  const fromRepoRoot = resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
    path,
  );
  return existsSync(fromRepoRoot) ? fromRepoRoot : path;
}

export interface SeedResult {
  customerId: string;
  email: string;
  created: boolean;
  watchIds: string[];
  /** Watches dropped from the file; deactivated, not deleted. */
  deactivated: number;
}

/**
 * Parse and validate a seed file without touching the database.
 *
 * Separate from applying it so a bad file fails before any row is written —
 * a half-onboarded customer is worse than an un-onboarded one.
 */
export function parseSeedFile(path: string): SeedFile {
  const raw = JSON.parse(readFileSync(resolveSeedPath(path), "utf8")) as unknown;
  const parsed = seedFileSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`${path} is not a valid seed file:\n${detail}`);
  }

  // Zod cannot check that a timezone actually exists; Intl can, and a typo
  // here would otherwise surface as a digest that never sends.
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.customer.tz });
  } catch {
    throw new Error(
      `unknown timezone "${parsed.data.customer.tz}" — use an IANA name such as Europe/London`,
    );
  }

  return parsed.data;
}

export async function applySeed(db: Db, seed: SeedFile): Promise<SeedResult> {
  const existing = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(eq(schema.customers.email, seed.customer.email))
    .limit(1);
  const created = existing.length === 0;

  const [customer] = await db
    .insert(schema.customers)
    .values({
      email: seed.customer.email,
      name: seed.customer.name,
      tz: seed.customer.tz,
      digestHour: seed.customer.digestHour,
      status: seed.customer.status,
      ...(seed.customer.plan === undefined ? {} : { plan: seed.customer.plan }),
    })
    .onConflictDoUpdate({
      target: schema.customers.email,
      set: {
        name: seed.customer.name,
        tz: seed.customer.tz,
        digestHour: seed.customer.digestHour,
        status: seed.customer.status,
      },
    })
    .returning({ id: schema.customers.id });

  if (customer === undefined) throw new Error("failed to upsert customer");

  await db
    .insert(schema.profiles)
    .values({ customerId: customer.id, ...seed.profile })
    .onConflictDoUpdate({
      target: schema.profiles.customerId,
      set: { ...seed.profile, updatedAt: new Date() },
    });

  // Upserted on (customer_id, name), never deleted and recreated.
  //
  // Recreating them looks harmless and is not: watches cascade to item_watches
  // and classifications, so re-running a seed to add one search term would wipe
  // every verdict already paid for and leave the customer's lead history empty.
  const watchIds: string[] = [];
  for (const watch of seed.watches) {
    const values = {
      customerId: customer.id,
      name: watch.name,
      sources: watch.sources,
      subreddits: watch.subreddits,
      includeTerms: watch.includeTerms,
      excludeTerms: watch.excludeTerms,
      active: watch.active,
      ...(watch.sourceConfig === undefined ? {} : { sourceConfig: watch.sourceConfig }),
    };
    const [row] = await db
      .insert(schema.watches)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.watches.customerId, schema.watches.name],
        set: {
          sources: values.sources,
          subreddits: values.subreddits,
          includeTerms: values.includeTerms,
          excludeTerms: values.excludeTerms,
          active: values.active,
          sourceConfig: values.sourceConfig ?? null,
        },
      })
      .returning({ id: schema.watches.id });
    if (row !== undefined) watchIds.push(row.id);
  }

  // A watch dropped from the file is deactivated rather than deleted, so its
  // history survives and it simply stops being scheduled.
  const removed = await db
    .update(schema.watches)
    .set({ active: false })
    .where(
      and(
        eq(schema.watches.customerId, customer.id),
        notInArray(schema.watches.name, seed.watches.map((w) => w.name)),
      ),
    )
    .returning({ id: schema.watches.id });

  return {
    customerId: customer.id,
    email: seed.customer.email,
    created,
    watchIds,
    deactivated: removed.length,
  };
}
