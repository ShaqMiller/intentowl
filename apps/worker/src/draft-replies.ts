/**
 * `cli draft-replies` — turn stored leads into replies you can paste.
 *
 * The digest tells you a post is worth answering. This writes the answer, as a
 * markdown file with the original post next to each draft, so the judgement
 * stays with the person sending it. Nothing is posted and nothing is emailed;
 * every source we read forbids using what we collect to contact people
 * unsolicited, and replying in public under your own name is the whole model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { draftReply, type ReplyContext, type ReplyLead } from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { env } from "./env.ts";

export interface DraftRepliesOptions {
  db: Db;
  customerId: string;
  limit: number;
  minScore: number;
  days: number;
  out: string;
  /** The offer to mention once, at the end of each reply. */
  trialLine: string;
  appUrl: string;
}

export interface DraftRepliesOutcome {
  leads: number;
  drafted: number;
  costUsd: number;
  path: string;
}

export async function draftReplies(options: DraftRepliesOptions): Promise<DraftRepliesOutcome> {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (apiKey === undefined) throw new Error("ANTHROPIC_API_KEY is not set");

  const [customer] = await options.db
    .select({ name: schema.customers.name, email: schema.customers.email })
    .from(schema.customers)
    .where(eq(schema.customers.id, options.customerId))
    .limit(1);
  if (customer === undefined) throw new Error(`customer ${options.customerId} not found`);

  const [profile] = await options.db
    .select({ productDesc: schema.profiles.productDesc, icpDesc: schema.profiles.icpDesc })
    .from(schema.profiles)
    .where(eq(schema.profiles.customerId, options.customerId))
    .limit(1);
  if (profile?.productDesc == null || profile.productDesc.trim() === "") {
    throw new Error("this customer has no product description; fill in What you sell first");
  }

  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
  const rows = await options.db
    .select({
      title: schema.items.title,
      body: schema.items.body,
      url: schema.items.url,
      venue: schema.items.venue,
      author: schema.items.author,
      source: schema.items.source,
      postedAt: schema.items.postedAt,
      score: schema.classifications.score,
      reason: schema.classifications.reason,
      replyAngle: schema.classifications.replyAngle,
      watch: schema.watches.name,
      verdict: schema.feedback.verdict,
    })
    .from(schema.classifications)
    .innerJoin(schema.items, eq(schema.items.id, schema.classifications.itemId))
    .innerJoin(schema.watches, eq(schema.watches.id, schema.classifications.watchId))
    .leftJoin(
      schema.feedback,
      and(
        eq(schema.feedback.itemId, schema.classifications.itemId),
        eq(schema.feedback.customerId, options.customerId),
      ),
    )
    .where(
      and(
        eq(schema.watches.customerId, options.customerId),
        eq(schema.classifications.relevant, true),
        gte(schema.classifications.score, options.minScore),
        gte(schema.items.fetchedAt, since),
      ),
    )
    .orderBy(desc(schema.classifications.score))
    .limit(options.limit * 3);

  // One row per post: a post can be found by two searches, and a lead is a
  // post, not a pairing.
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = best.get(row.url);
    if (existing === undefined || row.score > existing.score) best.set(row.url, row);
  }
  // Anything already marked "not for me" is not worth a reply.
  const leads = [...best.values()]
    .filter((row) => row.verdict !== "down")
    .slice(0, options.limit);

  const context: ReplyContext = {
    productName: "IntentOwl",
    productDesc: profile.productDesc,
    icpDesc: profile.icpDesc ?? "founders of small software companies",
    trialLine: options.trialLine,
    url: options.appUrl,
  };

  const parts: string[] = [
    `# Replies to draft — ${customer.email}`,
    "",
    `${leads.length} lead(s), scored ${options.minScore}+, from the last ${options.days} days.`,
    "Every reply is a draft. Read it, make it yours, and post it yourself.",
    "",
  ];
  let costUsd = 0;
  let drafted = 0;

  for (const [index, row] of leads.entries()) {
    const lead: ReplyLead = {
      title: row.title,
      body: row.body,
      url: row.url,
      venue: row.venue,
      author: row.author,
      source: row.source,
      score: row.score,
      reason: row.reason,
      replyAngle: row.replyAngle,
    };

    const heading = `## ${String(index + 1)}. ${row.title ?? (row.body ?? "").slice(0, 70)}`;
    const meta = [
      `**Score ${String(row.score)}** · ${row.venue ?? row.source} · ${row.author ?? "unknown"}`,
      row.postedAt === null ? null : `posted ${row.postedAt.toISOString().slice(0, 10)}`,
      `found by "${row.watch}"`,
    ]
      .filter((part) => part !== null)
      .join(" · ");

    const post = (row.body ?? "").trim();
    const section = [heading, "", meta, "", row.url, ""];
    if (post !== "") {
      section.push("> " + post.slice(0, 1200).replace(/\n+/g, "\n> "), "");
    }
    if (row.reason !== null) section.push(`**Why it matters:** ${row.reason}`, "");

    try {
      const result = await draftReply(lead, context, {
        apiKey,
        ...(env.ANTHROPIC_WORKSPACE_ID === undefined
          ? {}
          : { workspaceId: env.ANTHROPIC_WORKSPACE_ID }),
      });
      costUsd += result.costUsd;
      drafted += 1;
      section.push("**Draft reply**", "", result.draft.reply, "");
      if (result.draft.risk.toLowerCase() !== "none") {
        section.push(`_Watch out: ${result.draft.risk}_`, "");
      }
    } catch (error) {
      section.push(
        `_No draft: ${error instanceof Error ? error.message : String(error)}_`,
        "",
      );
    }

    section.push("---", "");
    parts.push(...section);
  }

  parts.push(
    "",
    `Drafted ${String(drafted)} of ${String(leads.length)} · cost $${costUsd.toFixed(4)}`,
  );
  // The CLI runs from the worker package, so a relative path lands there;
  // resolve it and make the folder rather than failing after paying for
  // the drafts.
  const path = resolve(options.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, parts.join("\n"), "utf8");

  return { leads: leads.length, drafted, costUsd, path };
}

/** Resolve an email or an id to a customer id. */
export async function resolveCustomer(db: Db, who: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(who)) return who;
  const [row] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(sql`lower(${schema.customers.email}) = ${who.toLowerCase()}`)
    .limit(1);
  if (row === undefined) throw new Error(`no customer with email ${who}`);
  return row.id;
}
