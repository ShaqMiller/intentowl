/**
 * Parsing and validation for the search form.
 *
 * Separate from actions.ts because a "use server" module may only export async
 * functions, and these rules deserve unit tests of their own: they are the
 * difference between a search that reads something and one that fails every
 * poll in silence.
 */
import { z } from "zod";

/** Sources the pipeline can actually poll. Mirrors the `source` enum. */
export const SOURCE = z.enum([
  "reddit",
  "hn",
  "lobsters",
  "stackexchange",
  "bluesky",
  "rss",
  "x",
  "threads",
  "github",
]);

/**
 * One entry per line only. Used for values that may legitimately contain a
 * comma — a URL query string, for instance — which `parseList` would split.
 */
export function parseLines(raw: FormDataEntryValue | null): string[] {
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
export function parseList(raw: FormDataEntryValue | null): string[] {
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
export const feedUrl = z
  .string()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Feed URLs must start with http:// or https://");

export const watchSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name").max(80),
  sources: z.array(SOURCE).min(1, "Pick at least one source"),
  includeTerms: z.array(z.string().min(1)).max(60),
  excludeTerms: z.array(z.string().min(1)).max(60),
  subreddits: z.array(z.string().min(1)).max(40),
  feeds: z.array(feedUrl).max(20),
  active: z.boolean(),
})
  // RSS with no feeds has nothing to read: every poll fails and the search
  // finds nothing, silently. Feeds without RSS ticked are fine — they are kept
  // for when it is switched on.
  .refine((w) => !w.sources.includes("rss") || w.feeds.length > 0, {
    path: ["feeds"],
    message: "RSS feeds needs at least one feed URL. Add one, or untick RSS feeds.",
  });

export function readWatchForm(form: FormData) {
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
export function toWatchRow(data: z.infer<typeof watchSchema>) {
  const { feeds, ...columns } = data;
  return {
    ...columns,
    sourceConfig: feeds.length > 0 ? { rss: { feeds } } : null,
  };
}
