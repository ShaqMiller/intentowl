import { describe, expect, it } from "vitest";

import { readWatchForm, toWatchRow } from "./watch-form.ts";

/** A form as the browser submits it: one entry per ticked source. */
function form(fields: {
  name?: string;
  sources?: string[];
  includeTerms?: string;
  excludeTerms?: string;
  subreddits?: string;
  feeds?: string;
  active?: boolean;
}): FormData {
  const data = new FormData();
  data.set("name", fields.name ?? "Test search");
  for (const source of fields.sources ?? ["hn"]) data.append("sources", source);
  data.set("includeTerms", fields.includeTerms ?? "late payments");
  data.set("excludeTerms", fields.excludeTerms ?? "");
  data.set("subreddits", fields.subreddits ?? "");
  data.set("feeds", fields.feeds ?? "");
  if (fields.active !== false) data.set("active", "on");
  return data;
}

function errorOf(result: ReturnType<typeof readWatchForm>): string | undefined {
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("the RSS rule", () => {
  it("refuses RSS with no feed URLs", () => {
    const result = readWatchForm(form({ sources: ["hn", "rss"], feeds: "" }));

    expect(errorOf(result)).toMatch(/at least one feed URL/);
  });

  it("allows every other source with no feed URLs", () => {
    // The case a customer hit: nothing about RSS on the form, and the save was
    // refused anyway. It must not be.
    for (const source of ["hn", "lobsters", "stackexchange", "bluesky", "github"]) {
      const result = readWatchForm(form({ sources: [source], feeds: "" }));
      expect(errorOf(result), source).toBeUndefined();
    }
  });

  it("allows RSS once a feed is added", () => {
    const result = readWatchForm(
      form({ sources: ["rss"], feeds: "https://example.com/feed.xml" }),
    );

    expect(result.success).toBe(true);
  });

  it("keeps feeds saved for later when RSS is not ticked", () => {
    const result = readWatchForm(
      form({ sources: ["hn"], feeds: "https://example.com/feed.xml" }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(toWatchRow(result.data).sourceConfig).toEqual({
      rss: { feeds: ["https://example.com/feed.xml"] },
    });
  });
});

describe("the rest of the form", () => {
  it("needs a name and at least one source", () => {
    expect(errorOf(readWatchForm(form({ name: " " })))).toMatch(/name/i);
    expect(errorOf(readWatchForm(form({ sources: [] })))).toMatch(/at least one source/i);
  });

  it("splits lists on newlines, trims, and drops duplicates", () => {
    const result = readWatchForm(
      form({ includeTerms: " late payments \n\nlate payments\nchasing invoices " }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.includeTerms).toEqual(["late payments", "chasing invoices"]);
  });

  it("accepts a subreddit with or without the r/ and stores one shape", () => {
    const result = readWatchForm(form({ subreddits: "r/SaaS\n/r/startups\nfreelance" }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.subreddits).toEqual(["SaaS", "startups", "freelance"]);
  });

  it("rejects a feed URL that is not http(s)", () => {
    const result = readWatchForm(form({ sources: ["rss"], feeds: "example.com/feed" }));

    expect(errorOf(result)).toMatch(/http/i);
  });
});
