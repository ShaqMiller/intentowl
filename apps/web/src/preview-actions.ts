"use server";

/**
 * "What do these words actually catch?"
 *
 * The honest answer to the question every terms field raises, measured rather
 * than guessed: run the real pre-filter over the posts we have already read
 * and report how many it keeps, with a few titles.
 *
 * Free and instant — `applyFilter` is a pure function and the posts are
 * already stored, so this costs one query and no model call. It exists because
 * a term like `go to market` matched 193 posts and produced no leads for
 * weeks, and nothing in the product said so.
 */
import { applyFilter } from "@intentowl/core";
import { desc, gte } from "drizzle-orm";

import { schema } from "@intentowl/db";

import { getDb } from "./db.ts";
import { requireCustomer } from "./session.ts";

/** Enough to be representative, small enough to stay instant. */
const SAMPLE = 500;
const LOOKBACK_DAYS = 14;
const EXAMPLES = 5;

export interface TermPreview {
  scanned: number;
  matched: number;
  examples: Array<{ title: string; source: string }>;
  message?: string;
}

function lines(form: FormData, field: string): string[] {
  const raw = form.get(field);
  if (typeof raw !== "string") return [];
  return [...new Set(raw.split("\n").map((line) => line.trim()).filter((line) => line !== ""))];
}

export async function previewTerms(form: FormData): Promise<TermPreview> {
  await requireCustomer();

  const includeTerms = lines(form, "includeTerms");
  const excludeTerms = lines(form, "excludeTerms");
  if (includeTerms.length === 0) {
    return { scanned: 0, matched: 0, examples: [], message: "Add a word to see what it catches." };
  }

  const db = getDb();
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Everyone's recent posts, not just this customer's: the point is to show
  // what these words would catch out in the world, including for a search that
  // has never run. Only public posts are stored, and only title and source are
  // read back here.
  const rows = await db
    .select({
      title: schema.items.title,
      body: schema.items.body,
      venue: schema.items.venue,
      author: schema.items.author,
      source: schema.items.source,
    })
    .from(schema.items)
    .where(gte(schema.items.fetchedAt, since))
    .orderBy(desc(schema.items.fetchedAt))
    .limit(SAMPLE);

  const examples: TermPreview["examples"] = [];
  let matched = 0;
  for (const row of rows) {
    const verdict = applyFilter(row, { includeTerms, excludeTerms });
    if (!verdict.keep) continue;
    matched += 1;
    if (examples.length < EXAMPLES && (row.title ?? "").trim() !== "") {
      examples.push({ title: row.title ?? "", source: row.source });
    }
  }

  return {
    scanned: rows.length,
    matched,
    examples,
    ...(matched === 0
      ? {
          message:
            "Nothing in the last two weeks. That can mean the words are too specific, or too rare — try a plainer phrase.",
        }
      : {}),
  };
}
