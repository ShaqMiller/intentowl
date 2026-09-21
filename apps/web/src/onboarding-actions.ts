"use server";

/**
 * Self-serve setup: draft a profile and first search with Claude, then save
 * what the founder approves.
 *
 * Replaces "reply to your receipt with four things and I will set you up by
 * hand", which does not survive a $15 plan with a 7-day trial: a trial that
 * waits a day for a human loses a seventh of itself before the first digest.
 *
 * Drafting degrades rather than blocks. Without an API key, over the daily
 * limit, or on any model failure, the founder gets the same review form to
 * fill in by hand — setup never depends on the model being up.
 */
import { draftOnboarding, type OnboardingDraft } from "@intentowl/core";
import { schema } from "@intentowl/db";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createWatch, updateProfile, type ActionResult } from "./actions.ts";
import { getDb } from "./db.ts";
import { env } from "./env.ts";
import { getProfile, listWatches } from "./queries.ts";
import { requireCustomer } from "./session.ts";

/** Drafts per customer per day. Each costs about a cent; this caps a runaway retry loop. */
const DAILY_DRAFTS = 5;

/** The `api_usage.source` drafts are counted and costed under. */
const USAGE_SOURCE = "onboarding-draft";

export type DraftState =
  | { stage: "describe"; message?: string }
  | { stage: "review"; draft: OnboardingDraft; drafted: boolean; message?: string };

const inputSchema = z.object({
  description: z
    .string()
    .trim()
    .min(20, "Give it at least a sentence or two — what it does and who it is for.")
    .max(3000, "Keep it under 3,000 characters; the first few sentences matter most."),
  audience: z.string().trim().max(1000).optional(),
  competitors: z.string().trim().max(500).optional(),
});

function emptyDraft(description: string): OnboardingDraft {
  return {
    productDesc: description,
    icpDesc: "",
    competitors: [],
    disqualifiers: [],
    includeTerms: [],
    excludeTerms: ['"who is hiring"', '"for hire"'],
    searchName: "My first search",
  };
}

export async function draftSetup(_previous: DraftState, form: FormData): Promise<DraftState> {
  const customer = await requireCustomer();

  const parsed = inputSchema.safeParse({
    description: form.get("description") ?? "",
    audience: form.get("audience") ?? undefined,
    competitors: form.get("competitors") ?? undefined,
  });
  if (!parsed.success) {
    return { stage: "describe", message: parsed.error.issues[0]?.message ?? "Check what you wrote." };
  }
  const input = parsed.data;
  const manual = (message: string): DraftState => ({
    stage: "review",
    draft: emptyDraft(input.description),
    drafted: false,
    message,
  });

  if (env.ANTHROPIC_API_KEY === undefined) {
    return manual("Automatic drafting is not switched on yet, so fill these in yourself — the hints say what each one does.");
  }

  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const [used] = await db
    .select({ calls: schema.apiUsage.calls })
    .from(schema.apiUsage)
    .where(
      and(
        eq(schema.apiUsage.customerId, customer.id),
        eq(schema.apiUsage.source, USAGE_SOURCE),
        eq(schema.apiUsage.day, today),
      ),
    );
  if ((used?.calls ?? 0) >= DAILY_DRAFTS) {
    return manual(`That is ${DAILY_DRAFTS} drafts today, the daily limit. Edit this one by hand, or try again tomorrow.`);
  }

  try {
    const result = await draftOnboarding(
      {
        description: input.description,
        ...(input.audience === undefined ? {} : { audience: input.audience }),
        ...(input.competitors === undefined ? {} : { competitors: input.competitors }),
      },
      {
        apiKey: env.ANTHROPIC_API_KEY,
        ...(env.ANTHROPIC_WORKSPACE_ID === undefined ? {} : { workspaceId: env.ANTHROPIC_WORKSPACE_ID }),
      },
    );

    const cost = result.costUsd.toFixed(6);
    await db
      .insert(schema.apiUsage)
      .values({
        customerId: customer.id,
        source: USAGE_SOURCE,
        calls: 1,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        costUsd: cost,
        day: today,
      })
      .onConflictDoUpdate({
        target: [schema.apiUsage.customerId, schema.apiUsage.source, schema.apiUsage.day],
        set: {
          calls: sql`${schema.apiUsage.calls} + 1`,
          tokensIn: sql`${schema.apiUsage.tokensIn} + ${result.usage.tokensIn}`,
          tokensOut: sql`${schema.apiUsage.tokensOut} + ${result.usage.tokensOut}`,
          costUsd: sql`${schema.apiUsage.costUsd} + ${cost}`,
        },
      });

    return { stage: "review", draft: result.draft, drafted: true };
  } catch (error) {
    console.error("onboarding draft failed", error);
    return manual("The draft did not come back this time, so fill these in yourself — or go back and try again in a minute.");
  }
}

/**
 * Save the approved profile and start the first search, then open the leads
 * page. Reuses the dashboard's own actions, so validation and the plan's search
 * limit are exactly the same as editing by hand.
 */
export async function completeSetup(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  const customer = await requireCustomer();

  // First-time setup only. A customer who already has a profile and a search
  // edits them in place, where nothing overwrites tuning they have done.
  const [profile, watches] = await Promise.all([getProfile(customer.id), listWatches(customer.id)]);
  if ((profile?.productDesc ?? null) !== null && watches.length > 0) {
    return { ok: false, message: "You are already set up. Edit your profile under What you sell, or add a search under Searches." };
  }

  const saved = await updateProfile(form);
  if (!saved.ok) return saved;

  const created = await createWatch(form);
  if (!created.ok) return created;

  redirect("/dashboard?welcome=1");
}
