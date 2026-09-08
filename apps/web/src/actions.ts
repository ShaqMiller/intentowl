"use server";

/**
 * Server actions for the dashboard.
 *
 * Two rules, both load-bearing:
 *
 * 1. Every action re-resolves the session itself. A form field naming a watch
 *    id is attacker-controlled, so ownership is checked against the session on
 *    the server, never trusted from the request.
 * 2. Every input goes through Zod. These write to the same tables the pipeline
 *    reads, and a watch with a null name or an unknown source breaks the poller
 *    at 3am rather than here.
 */
import { schema } from "@intentowl/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getDb } from "./db.ts";
import { requireCustomer } from "./session.ts";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Sources the pipeline can actually poll. Mirrors the `source` enum. */
const SOURCE = z.enum([
  "reddit",
  "hn",
  "lobsters",
  "stackexchange",
  "bluesky",
  "rss",
  "x",
]);

/**
 * One entry per line only. Used for values that may legitimately contain a
 * comma — a URL query string, for instance — which `parseList` would split.
 */
function parseLines(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  const parts = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(parts)];
}

/**
 * Turns a textarea into a clean string array: one entry per line or comma,
 * trimmed, blanks dropped, duplicates removed, order preserved.
 */
function parseList(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string") return [];
  const parts = raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(parts)];
}

/**
 * Feed URLs are fetched by our own server, so the scheme is checked here as
 * well as in the adapter. Belt and braces on purpose: this is the boundary
 * where a customer's text becomes a URL we will later request.
 */
const feedUrl = z
  .string()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Feed URLs must start with http:// or https://");

const watchSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name").max(80),
  sources: z.array(SOURCE).min(1, "Pick at least one source"),
  includeTerms: z.array(z.string().min(1)).max(60),
  excludeTerms: z.array(z.string().min(1)).max(60),
  subreddits: z.array(z.string().min(1)).max(40),
  feeds: z.array(feedUrl).max(20),
  active: z.boolean(),
});

function readWatchForm(form: FormData) {
  return watchSchema.safeParse({
    name: form.get("name"),
    sources: form.getAll("sources").filter((v) => typeof v === "string"),
    includeTerms: parseList(form.get("includeTerms")),
    excludeTerms: parseList(form.get("excludeTerms")),
    subreddits: parseList(form.get("subreddits")).map((s) =>
      // Accept "r/SaaS", "/r/SaaS" or "SaaS" and store one shape.
      s.replace(/^\/?r\//i, ""),
    ),
    // Commas are legal inside a URL, so feeds split on newlines only —
    // parseList would cut a query string in half.
    feeds: parseLines(form.get("feeds")),
    active: form.get("active") === "on",
  });
}

/**
 * Split the validated form into the watch columns and the per-source jsonb.
 *
 * `feeds` is not a column: `sourceConfig` is where settings that do not
 * deserve one live, and the RSS adapter reads them from `rss.feeds`.
 */
function toWatchRow(data: z.infer<typeof watchSchema>) {
  const { feeds, ...columns } = data;
  return {
    ...columns,
    sourceConfig: feeds.length > 0 ? { rss: { feeds } } : null,
  };
}

export async function createWatch(form: FormData): Promise<ActionResult> {
  const customer = await requireCustomer();
  const parsed = readWatchForm(form);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = getDb();
  try {
    await db.insert(schema.watches).values({
      customerId: customer.id,
      ...toWatchRow(parsed.data),
    });
  } catch (error) {
    // The unique index on (customer_id, name) is the likely cause, and a
    // duplicate name is a user mistake rather than a server fault.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("watches_customer_name_key")) {
      return { ok: false, message: "You already have a search with that name." };
    }
    throw error;
  }

  revalidatePath("/dashboard/searches");
  return { ok: true, message: "Search created." };
}

export async function updateWatch(form: FormData): Promise<ActionResult> {
  const customer = await requireCustomer();

  const id = form.get("id");
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, message: "Missing search id" };
  }

  const parsed = readWatchForm(form);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = getDb();
  // The customerId in the WHERE clause is the authorisation check: a forged id
  // belonging to someone else matches zero rows and updates nothing.
  const updated = await db
    .update(schema.watches)
    .set(toWatchRow(parsed.data))
    .where(
      and(
        eq(schema.watches.id, id),
        eq(schema.watches.customerId, customer.id),
      ),
    )
    .returning({ id: schema.watches.id });

  if (updated.length === 0) {
    return { ok: false, message: "That search does not exist." };
  }

  revalidatePath("/dashboard/searches");
  revalidatePath(`/dashboard/searches/${id}`);
  return { ok: true, message: "Saved." };
}

/**
 * Pause or resume a search.
 *
 * Deliberately no delete: removing a watch cascades to item_watches and
 * classifications, destroying lead history that cost real money to produce.
 * Pausing stops the polling and costs nothing to undo.
 */
export async function setWatchActive(form: FormData): Promise<ActionResult> {
  const customer = await requireCustomer();
  const id = form.get("id");
  const active = form.get("active") === "true";
  if (typeof id !== "string") return { ok: false, message: "Missing search id" };

  const db = getDb();
  const updated = await db
    .update(schema.watches)
    .set({ active })
    .where(
      and(
        eq(schema.watches.id, id),
        eq(schema.watches.customerId, customer.id),
      ),
    )
    .returning({ id: schema.watches.id });

  if (updated.length === 0) return { ok: false, message: "That search does not exist." };

  revalidatePath("/dashboard/searches");
  return { ok: true, message: active ? "Search resumed." : "Search paused." };
}

const profileSchema = z.object({
  productDesc: z.string().trim().max(4000).nullable(),
  icpDesc: z.string().trim().max(4000).nullable(),
  competitors: z.array(z.string().min(1)).max(40),
  disqualifiers: z.array(z.string().min(1)).max(40),
});

/**
 * The product description the classifier judges every post against.
 * This is the single biggest lever on result quality, which is why it lives on
 * its own page rather than buried in settings.
 */
export async function updateProfile(form: FormData): Promise<ActionResult> {
  const customer = await requireCustomer();

  const text = (key: string): string | null => {
    const v = form.get(key);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const parsed = profileSchema.safeParse({
    productDesc: text("productDesc"),
    icpDesc: text("icpDesc"),
    competitors: parseList(form.get("competitors")),
    disqualifiers: parseList(form.get("disqualifiers")),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = getDb();
  await db
    .insert(schema.profiles)
    .values({ customerId: customer.id, ...parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.profiles.customerId,
      set: { ...parsed.data, updatedAt: new Date() },
    });

  revalidatePath("/dashboard/profile");
  return { ok: true, message: "Profile saved. It applies to the next classification run." };
}

const deliverySchema = z.object({
  name: z.string().trim().max(120).nullable(),
  // Validated against the runtime's own tz database rather than a hardcoded
  // list, so it stays correct as zones change.
  tz: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, "Unrecognised timezone"),
  digestHour: z.number().int().min(0).max(23),
});

export async function updateDelivery(form: FormData): Promise<ActionResult> {
  const customer = await requireCustomer();

  const name = form.get("name");
  const parsed = deliverySchema.safeParse({
    name: typeof name === "string" && name.trim().length > 0 ? name.trim() : null,
    tz: form.get("tz"),
    digestHour: Number(form.get("digestHour")),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = getDb();
  await db
    .update(schema.customers)
    .set(parsed.data)
    .where(eq(schema.customers.id, customer.id));

  revalidatePath("/dashboard/settings");
  // The worker re-reads schedules on its own sync, so the new hour takes effect
  // without a deploy — but not instantly. Say so rather than implying it did.
  return {
    ok: true,
    message: "Saved. The new send time takes effect from the next schedule sync.",
  };
}
