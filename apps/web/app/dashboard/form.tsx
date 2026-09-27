"use client";

/**
 * Form wrapper for server actions.
 *
 * Carries the three states every form needs and most forms skip: pending
 * (so nobody double-submits a save), success, and a readable failure. The
 * result comes back from the action itself rather than from a thrown error,
 * because "you already have a search with that name" is information, not a
 * crash.
 */
import { useActionState, useEffect, useState, type ReactNode } from "react";

import { IconCheck } from "./icons.tsx";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className,
  variant = "plain",
  footer,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
  /**
   * `card` puts the button in a setting-card footer bar alongside a line
   * stating what the change does; `plain` keeps the older inline layout.
   */
  variant?: "plain" | "card";
  /** Shown on the left of the footer bar, replaced by the result once saved. */
  footer?: string;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, form) => action(form), null);

  // A result describes the form as it was when it was sent. Once the customer
  // edits anything it is history, and leaving it on screen reads as a live
  // complaint about what they are looking at now — someone unticked RSS feeds
  // and the "needs a feed URL" error stayed put, which is a bug report we
  // earned.
  const [edited, setEdited] = useState(false);
  useEffect(() => setEdited(false), [state]);

  const button = (
    <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
      {pending ? "Saving…" : submitLabel}
    </button>
  );

  const result =
    state === null || edited ? null : (
      <p
        className={state.ok ? "flash ok" : "flash bad"}
        role="status"
        aria-live="polite"
      >
        {state.ok && <IconCheck size={13} />} {state.message}
      </p>
    );

  if (variant === "card") {
    return (
      <form action={formAction} className={className} onInput={() => setEdited(true)} onChange={() => setEdited(true)}>
        {children}
        <div className="setcard-foot">
          {/* The consequence of saving, until there is a result to show
              instead — so the footer is never just a button on a bar. */}
          {result ?? <span>{footer}</span>}
          {button}
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className={className} onInput={() => setEdited(true)} onChange={() => setEdited(true)}>
      {children}
      <div className="form-foot">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {result}
      </div>
    </form>
  );
}

/**
 * A single button that posts a server action — pause/resume and the like.
 * Same pending handling, no field layout.
 */
export function ActionButton({
  action,
  fields,
  label,
  icon,
  variant,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  label: string;
  icon?: ReactNode;
  variant?: "primary";
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, form) => action(form), null);

  return (
    <form action={formAction} className="inline-form">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        className={variant === "primary" ? "btn btn-primary btn-sm" : "btn btn-sm"}
        type="submit"
        disabled={pending}
      >
        {icon}
        {pending ? "…" : label}
      </button>
      {state !== null && !state.ok && (
        <span className="flash bad">{state.message}</span>
      )}
    </form>
  );
}
