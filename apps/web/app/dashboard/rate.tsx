"use client";

/**
 * Good lead / Not for me on a dashboard lead.
 *
 * Optimistic, because a rating is a quick judgement made while scanning a list
 * and a spinner on every click would make it feel like paperwork. If the save
 * fails, the control falls back to what the server has and the reason shows.
 * A rated lead shows the choice with an Undo, which removes the rating.
 */
import { useOptimistic, useState, useTransition } from "react";

import { rateLead } from "../../src/actions.ts";
import { IconCheck, IconX } from "./icons.tsx";

type Verdict = "up" | "down" | null;

export function RateLead({ itemId, initial }: { itemId: string; initial: Verdict }) {
  const [verdict, setVerdict] = useOptimistic<Verdict, Verdict>(initial, (_current, next) => next);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(next: Verdict) {
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

  const problem =
    error !== null ? (
      <span className="flash bad" role="status">
        {error}
      </span>
    ) : null;

  // Once rated, the buttons give way to a record of the choice. Undo clears
  // the rating, which brings the buttons back.
  if (verdict !== null) {
    const up = verdict === "up";
    return (
      <div className="rate" role="group" aria-label="Your rating">
        {problem}
        <span
          className={up ? "rated rated-up" : "rated rated-down"}
          role="status"
          title={`${up ? "More like this" : "Fewer like this"} — learned within the hour`}
        >
          {up ? <IconCheck size={14} /> : <IconX size={14} />}
          {up ? "You rated this a good lead" : "You rated this not for me"}
        </span>
        <button type="button" className="rate-undo" disabled={pending} onClick={() => save(null)}>
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="rate" role="group" aria-label="Rate this lead">
      {problem}
      <button
        type="button"
        className="btn btn-sm rate-btn rate-down"
        disabled={pending}
        onClick={() => save("down")}
      >
        <IconX size={14} />
        Not for me
      </button>
      <button
        type="button"
        className="btn btn-sm rate-btn rate-up"
        disabled={pending}
        onClick={() => save("up")}
      >
        <IconCheck size={14} />
        Good lead
      </button>
    </div>
  );
}
