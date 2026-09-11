/**
 * Digest job — one execution is one customer, one channel, one day
 * (ARCHITECTURE.md sections 4.5 and 7).
 *
 * Every other stage is idempotent because a repeat is harmless: an upsert
 * writes the same row twice and nothing notices. This one is different —
 * **you cannot un-send an email**. So the job opens by asking whether it has
 * already sent today, measured on the *customer's* local day rather than UTC:
 * 23:30 and 00:30 UTC are the same morning in Auckland, and a UTC-day check
 * would cheerfully send twice.
 *
 * Degradation policy: if a source failed or the classifier is down, the digest
 * still goes out carrying a note saying so. Silence is the one unacceptable
 * failure for a product whose promise is "you won't miss leads".
 */
import {
  groupForDigest,
  rankLeads,
  renderDigest,
  renderSlackBlocks,
  postSlackDigest,
  sendDigestEmail,
  signFeedbackToken,
  type DigestGroup,
  type RankedLead,
  type ScorableLead,
} from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";

export const DIGEST_QUEUE = "digest";

/** Exported so the scheduler can create the queue before scheduling onto it. */
export const DIGEST_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 300,
} as const;

/** How far back a digest may reach for leads. */
const LOOKBACK_HOURS = 36;

/** Most leads a single digest will carry. */
const MAX_LEADS = 15;

export interface DigestJobData {
  customerId: string;
  /** Force a send even if one already went out today. Used by the CLI. */
  force?: boolean;
}

export interface DigestOutcome {
  customerId: string;
  channel: "email" | "slack";
  leadCount: number;
  degraded: boolean;
  /** True when the guard found today's digest already sent. */
  skipped: boolean;
  sent: boolean;
  subject?: string;
  html?: string;
  error?: string;
}

export interface RunDigestOptions {
  db: Db;
  customerId: string;
  /** Render and return, write nothing, send nothing. */
  dryRun?: boolean;
  force?: boolean;
  now?: Date;
}

export async function runDigest(
  options: RunDigestOptions,
): Promise<DigestOutcome> {
  const { db, customerId } = options;
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const log = logger.child({ customer_id: customerId });

  const customer = await loadCustomer(db, customerId);
  if (customer === null) throw new Error(`customer ${customerId} not found`);

  const outcome: DigestOutcome = {
    customerId,
    channel: "email",
    leadCount: 0,
    degraded: false,
    skipped: false,
    sent: false,
  };

  const localDay = localDayFor(now, customer.tz);

  if (!dryRun && options.force !== true) {
    const already = await sentToday(db, customerId, "email", customer.tz, localDay);
    if (already) {
      log.info({ local_day: localDay }, "digest already sent today; skipping");
      return { ...outcome, skipped: true };
    }
  }

  const leads = await loadLeads(db, customerId, now);
  const health = await sourceHealth(db, customerId, now);

  const ranked = rankLeads(leads, { now });
  const groups = groupForDigest(ranked, MAX_LEADS);
  outcome.leadCount = groups.reduce((n, g) => n + g.leads.length, 0);
  outcome.degraded = health.degraded;

  // Feedback links are omitted rather than rendered unverifiable when no
  // secret is configured: a thumbs-up that 404s teaches the customer the
  // feature is broken, which is worse than not offering it.
  const secret = env.FEEDBACK_SECRET;
  const rendered = await renderDigest({
    customerName: customer.name ?? "you",
    groups,
    dateLabel: dateLabelFor(now, customer.tz),
    appUrl: env.APP_URL,
    degradedNote: health.note,
    totalScanned: health.scanned,
    ...(secret === undefined
      ? {}
      : {
          feedbackToken: (itemId: string) =>
            signFeedbackToken(secret, customerId, itemId),
        }),
  });
  outcome.subject = rendered.subject;
  outcome.html = rendered.html;

  if (dryRun) {
    log.info(
      { leads: outcome.leadCount, degraded: outcome.degraded },
      "digest rendered (dry run, nothing written or sent)",
    );
    return outcome;
  }

  // The row goes in before the send, so a crash mid-send leaves evidence that
  // an attempt happened rather than silently re-sending on the next run.
  const digestId = await recordDigest(db, {
    customerId,
    channel: "email",
    itemCount: outcome.leadCount,
    degraded: outcome.degraded,
  });
  await recordDigestItems(db, digestId, groups);

  if (env.RESEND_API_KEY === undefined) {
    outcome.error = "RESEND_API_KEY is not set; digest recorded but not sent";
    log.warn(outcome.error);
    return outcome;
  }

  const result = await sendDigestEmail({
    apiKey: env.RESEND_API_KEY,
    from: env.DIGEST_FROM,
    // The From address is on a send-only subdomain; replies need a real inbox.
    ...(env.DIGEST_REPLY_TO === undefined
      ? {}
      : { replyTo: env.DIGEST_REPLY_TO }),
    to: customer.email,
    digest: rendered,
  });

  outcome.sent = result.ok;
  if (!result.ok) {
    outcome.error = result.error ?? "unknown send failure";
    log.error({ err: outcome.error }, "digest send failed");
  } else {
    log.info(
      { leads: outcome.leadCount, degraded: outcome.degraded, message_id: result.id },
      "digest sent",
    );
  }

  // Slack is an optional second channel, never a replacement for the email.
  if (customer.slackWebhookUrl !== null) {
    const slack = await postSlackDigest(
      customer.slackWebhookUrl,
      renderSlackBlocks(groups, {
        customerName: customer.name ?? "you",
        dateLabel: dateLabelFor(now, customer.tz),
        degradedNote: health.note,
      }),
    );
    if (!slack.ok) log.warn({ err: slack.error }, "slack digest failed");
  }

  return outcome;
}

// --- queue wiring -----------------------------------------------------------

export async function registerDigest(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(DIGEST_QUEUE, DIGEST_QUEUE_OPTIONS);

  await boss.work<DigestJobData>(DIGEST_QUEUE, { batchSize: 1 }, async (jobs) => {
    for (const job of jobs) {
      await runDigest({
        db,
        customerId: job.data.customerId,
        ...(job.data.force === true ? { force: true } : {}),
      });
    }
  });

  logger.info({ queue: DIGEST_QUEUE }, "digest worker registered");
}

// --- time -------------------------------------------------------------------

/**
 * The customer's local calendar day as YYYY-MM-DD.
 *
 * Built from `Intl` rather than arithmetic on a stored offset, because the
 * offset is not a constant — it moves twice a year, on different dates in
 * different countries. Storing "06:00 UTC" at signup is a correct answer to a
 * question that stops being true in late October.
 */
export function localDayFor(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function dateLabelFor(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
}

// --- persistence ------------------------------------------------------------

interface CustomerRow {
  email: string;
  name: string | null;
  tz: string;
  slackWebhookUrl: string | null;
}

async function loadCustomer(db: Db, customerId: string): Promise<CustomerRow | null> {
  const rows = await db
    .select({
      email: schema.customers.email,
      name: schema.customers.name,
      tz: schema.customers.tz,
    })
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  // Slack delivery is a customer-pasted webhook; no column for it until M6.
  return { ...row, slackWebhookUrl: null };
}

/** Has this customer already had a digest on their own local day? */
async function sentToday(
  db: Db,
  customerId: string,
  channel: "email" | "slack",
  tz: string,
  localDay: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.digests.id })
    .from(schema.digests)
    .where(
      and(
        eq(schema.digests.customerId, customerId),
        eq(schema.digests.channel, channel),
        // Compare in the customer's zone, not UTC.
        sql`(${schema.digests.sentAt} at time zone ${tz})::date = ${localDay}::date`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function loadLeads(
  db: Db,
  customerId: string,
  now: Date,
): Promise<ScorableLead[]> {
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);

  const rows = await db
    .select({
      itemId: schema.items.id,
      score: schema.classifications.score,
      relevant: schema.classifications.relevant,
      intent: schema.classifications.intent,
      reason: schema.classifications.reason,
      replyAngle: schema.classifications.replyAngle,
      title: schema.items.title,
      body: schema.items.body,
      url: schema.items.url,
      venue: schema.items.venue,
      author: schema.items.author,
      postedAt: schema.items.postedAt,
      engagement: schema.items.engagement,
    })
    .from(schema.classifications)
    .innerJoin(schema.items, eq(schema.items.id, schema.classifications.itemId))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.classifications.watchId))
    .where(
      and(
        eq(schema.watches.customerId, customerId),
        eq(schema.classifications.relevant, true),
        gte(schema.items.fetchedAt, since),
      ),
    )
    .orderBy(desc(schema.classifications.score))
    .limit(200);

  // A pair can carry both a Haiku and a Sonnet verdict; the digest wants one
  // lead per item, and the highest-scoring row is the escalated one.
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = best.get(row.itemId);
    if (existing === undefined || row.score > existing.score) best.set(row.itemId, row);
  }

  return [...best.values()].map((row) => ({
    itemId: row.itemId,
    score: row.score,
    relevant: row.relevant,
    intent: row.intent,
    title: row.title,
    body: row.body,
    url: row.url,
    venue: row.venue,
    author: row.author,
    postedAt: row.postedAt,
    reason: row.reason,
    replyAngle: row.replyAngle,
    engagement: (row.engagement ?? null) as Record<string, unknown> | null,
  }));
}

/**
 * Was any part of the pipeline degraded for this customer today?
 *
 * Drives the note in the email rather than any decision about whether to send:
 * a thin digest that explains itself keeps trust; a thin digest that doesn't
 * looks like a product quietly failing.
 */
async function sourceHealth(
  db: Db,
  customerId: string,
  now: Date,
): Promise<{ degraded: boolean; note: string | null; scanned: number }> {
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);

  const [scannedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.items)
    .innerJoin(schema.itemWatches, eq(schema.itemWatches.itemId, schema.items.id))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.itemWatches.watchId))
    .where(and(eq(schema.watches.customerId, customerId), gte(schema.items.fetchedAt, since)));

  const scanned = scannedRow?.n ?? 0;

  const configured = await db
    .select({ sources: schema.watches.sources })
    .from(schema.watches)
    .where(and(eq(schema.watches.customerId, customerId), eq(schema.watches.active, true)));

  const expected = new Set(configured.flatMap((w) => w.sources));

  const seen = await db
    .select({ source: schema.items.source })
    .from(schema.items)
    .innerJoin(schema.itemWatches, eq(schema.itemWatches.itemId, schema.items.id))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.itemWatches.watchId))
    .where(and(eq(schema.watches.customerId, customerId), gte(schema.items.fetchedAt, since)))
    .groupBy(schema.items.source);

  const seenSources = new Set(seen.map((s) => s.source));
  const missing = [...expected].filter((s) => !seenSources.has(s));

  if (missing.length === 0) return { degraded: false, note: null, scanned };
  return {
    degraded: true,
    note: `${missing.join(" and ")} data is delayed today — this digest may be thinner than usual.`,
    scanned,
  };
}

async function recordDigest(
  db: Db,
  row: {
    customerId: string;
    channel: "email" | "slack";
    itemCount: number;
    degraded: boolean;
  },
): Promise<string> {
  const [inserted] = await db
    .insert(schema.digests)
    .values(row)
    .returning({ id: schema.digests.id });
  if (inserted === undefined) throw new Error("failed to record digest");
  return inserted.id;
}

async function recordDigestItems(
  db: Db,
  digestId: string,
  groups: readonly DigestGroup[],
): Promise<void> {
  const rows: { digestId: string; itemId: string; rank: number }[] = [];
  let rank = 1;
  for (const group of groups) {
    for (const lead of group.leads as RankedLead[]) {
      rows.push({ digestId, itemId: lead.itemId, rank });
      rank += 1;
    }
  }
  if (rows.length === 0) return;
  await db.insert(schema.digestItems).values(rows).onConflictDoNothing();
}
