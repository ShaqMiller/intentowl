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
import { useActionState, type ReactNode } from "react";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, form) => action(form), null);

  return (
    <form action={formAction} className={className}>
      {children}
      <div className="form-foot">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {state !== null && (
          <p
            className={state.ok ? "flash ok" : "flash bad"}
            role="status"
            aria-live="polite"
          >
            {state.message}
          </p>
        )}
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
  variant,
}: {
  action: (form: FormData) => Promise<ActionResult>;
  fields: Record<string, string>;
  label: string;
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
        {pending ? "…" : label}
      </button>
      {state !== null && !state.ok && (
        <span className="flash bad">{state.message}</span>
      )}
    </form>
  );
}
