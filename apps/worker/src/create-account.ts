/**
 * Create a customer account directly, without Stripe or the signup pages.
 *
 * An account is a `customers` row. Logging in is separate and needs nothing
 * from here: the person sets a password at /login/claim with the same email,
 * confirms it from their inbox, and the first sign-in attaches their login to
 * this row (session.ts, claimByEmail). With no profile or search yet, they land
 * in the setup wizard.
 *
 * So no password ever passes through this script, and no Supabase admin key
 * is needed.
 *
 * Idempotent by email: running it again for an existing account reports it
 * and changes nothing, unless --update is passed.
 */
import { schema, type Db } from "@intentowl/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

/** Mirrors PLAN_IDS in apps/web/src/plans.ts; stored verbatim in customers.plan. */
const PLANS = ["starter-monthly", "starter-annual", "pro-monthly", "pro-annual"] as const;

const inputSchema = z.object({
  // Supabase stores emails lowercased, and claimByEmail matches exactly.
  email: z.email().transform((e) => e.trim().toLowerCase()),
  name: z.string().min(1).optional(),
  plan: z.enum(PLANS).optional(),
  tz: z.string().default("UTC"),
  digestHour: z.coerce.number().int().min(0).max(23).default(7),
  status: z.enum(["lead", "active", "churned"]).default("active"),
  update: z.boolean().default(false),
});

export type CreateAccountInput = z.input<typeof inputSchema>;

export interface CreateAccountResult {
  outcome: "created" | "updated" | "exists";
  id: string;
  email: string;
  claimed: boolean;
}

export async function createAccount(db: Db, raw: CreateAccountInput): Promise<CreateAccountResult> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`--${issue?.path.join(".") ?? "input"}: ${issue?.message ?? "invalid"}`);
  }
  const input = parsed.data;

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: input.tz });
  } catch {
    throw new Error(`unknown timezone "${input.tz}" — use an IANA name such as America/New_York`);
  }

  const [existing] = await db
    .select({ id: schema.customers.id, authUserId: schema.customers.authUserId })
    .from(schema.customers)
    .where(eq(schema.customers.email, input.email))
    .limit(1);

  const fields = {
    tz: input.tz,
    digestHour: input.digestHour,
    status: input.status,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.plan === undefined ? {} : { plan: input.plan }),
  };

  if (existing !== undefined) {
    if (input.update) {
      await db.update(schema.customers).set(fields).where(eq(schema.customers.id, existing.id));
    }
    return {
      outcome: input.update ? "updated" : "exists",
      id: existing.id,
      email: input.email,
      claimed: existing.authUserId !== null,
    };
  }

  const [row] = await db
    .insert(schema.customers)
    .values({ email: input.email, ...fields })
    .returning({ id: schema.customers.id });
  if (row === undefined) throw new Error("insert returned no row");

  return { outcome: "created", id: row.id, email: input.email, claimed: false };
}
