"use client";

/**
 * What the customer's other searches are already doing.
 *
 * Two searches reading the same source is the normal case, not a mistake:
 * "founders looking for first customers" and "people leaving Mixpanel" both
 * belong on Hacker News, and posts are stored once, so the second search is
 * nearly free. Overlapping *words* are the expensive part — a post caught by
 * two searches is judged by the model twice, and billed twice — so that is the
 * one worth interrupting for.
 *
 * Neither notice blocks anything. Blocking a source because another search
 * reads it would make the second search impossible to build.
 */
import { useEffect, useState } from "react";

import { IconAlert, IconGlobe } from "../icons.tsx";

export interface OtherSearch {
  name: string;
  sources: string[];
  includeTerms: string[];
}

/** Compared loosely: quotes are a matching instruction, not part of the word. */
function normalise(term: string): string {
  return term.trim().toLowerCase().replace(/^"|"$/g, "");
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

export function SourceOverlap({
  others,
  labels,
}: {
  others: OtherSearch[];
  labels: Record<string, string>;
}) {
  const withSources = others.filter((other) => other.sources.length > 0);
  if (withSources.length === 0) return null;

  return (
    <p className="overlap">
      <IconGlobe size={14} />
      <span>
        {withSources.map((other, index) => (
          <span key={other.name}>
            {index > 0 && " "}
            <b>{other.name}</b> already reads{" "}
            {list(other.sources.map((source) => labels[source] ?? source))}.
          </span>
        ))}{" "}
        Reading the same place twice is fine — you only pay twice when both
        searches match the same post.
      </span>
    </p>
  );
}

export function TermOverlap({ others }: { others: OtherSearch[] }) {
  const [shared, setShared] = useState<Array<{ name: string; terms: string[] }>>([]);

  useEffect(() => {
    if (others.length === 0) return;

    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[name="includeTerms"]',
    );
    const form = field?.form ?? null;
    if (form === null) return;

    const compare = (): void => {
      // Read the live field, not the saved search: the point is to warn while
      // the words are being typed.
      const current = new Set(
        new FormData(form)
          .getAll("includeTerms")
          .flatMap((value) => (typeof value === "string" ? value.split("\n") : []))
          .map(normalise)
          .filter((term) => term !== ""),
      );

      setShared(
        others
          .map((other) => ({
            name: other.name,
            terms: other.includeTerms.filter((term) => current.has(normalise(term))),
          }))
          .filter((entry) => entry.terms.length > 0),
      );
    };

    compare();
    form.addEventListener("input", compare);
    return () => form.removeEventListener("input", compare);
  }, [others]);

  if (shared.length === 0) return null;

  return (
    <p className="overlap overlap-warn">
      <IconAlert size={14} />
      <span>
        {shared.map((entry) => (
          <span key={entry.name}>
            <b>{entry.name}</b> also looks for{" "}
            {list(entry.terms.map((term) => `“${normalise(term)}”`))}.{" "}
          </span>
        ))}
        A post matching both searches is read by the model twice, and costs
        twice.
      </span>
    </p>
  );
}
