"use client";

/**
 * Good lead / Not for me on a dashboard lead.
 *
 * Optimistic, because a rating is a quick judgement made while scanning a list
 * and a spinner on every click would make it feel like paperwork. If the save
 * fails, the button falls back to what the server has and the reason shows.
 * Clicking the button that is already on removes the rating.
 */
import { useOptimistic, useState, useTransition } from "react";

import { rateLead } from "../../src/actions.ts";
import { IconCheck, IconX } from "./icons.tsx";

type Verdict = "up" | "down" | null;

export function RateLead({ itemId, initial }: { itemId: string; initial: Verdict }) {
  const [verdict, setVerdict] = useOptimistic<Verdict, Verdict>(initial, (_current, next) => next);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(clicked: "up" | "down") {
    const next = verdict === clicked ? null : clicked;
    setError(null);
    startTransition(async () => {
      setVerdict(next);
      const form = new FormData();
      form.set("itemId", itemId);
      form.set("verdict", next ?? "clear");
      const result = await rateLead(form);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="rate" role="group" aria-label="Rate this lead">
      <button
        type="button"
        className={verdict === "up" ? "btn btn-sm rate-btn is-up" : "btn btn-sm rate-btn"}
        aria-pressed={verdict === "up"}
        disabled={pending}
        onClick={() => choose("up")}
      >
        <IconCheck size={13} />
        Good lead
      </button>
      <button
        type="button"
        className={verdict === "down" ? "btn btn-sm rate-btn is-down" : "btn btn-sm rate-btn"}
        aria-pressed={verdict === "down"}
        disabled={pending}
        onClick={() => choose("down")}
      >
        <IconX size={13} />
        Not for me
      </button>
      {error !== null ? (
        <span className="flash bad" role="status">
          {error}
        </span>
      ) : (
        verdict !== null && (
          <span className="rate-note" role="status">
            {verdict === "up" ? "More like this" : "Fewer like this"} — learned within the hour
          </span>
        )
      )}
    </div>
  );
}
