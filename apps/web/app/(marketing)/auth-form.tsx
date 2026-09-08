"use client";

/**
 * Form wrapper for the auth actions.
 *
 * Separate from the dashboard's ActionForm because these actions can redirect.
 * A successful sign-in never returns — `redirect()` throws to unwind — so this
 * must not treat "no result came back" as a failure, and must keep the button
 * disabled while the navigation happens rather than inviting a second submit.
 */
import { useActionState, type ReactNode } from "react";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export function AuthForm({
  action,
  children,
  submitLabel,
}: {
  action: (form: FormData) => Promise<ActionResult | void>;
  children: ReactNode;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<
    ActionResult | null,
    FormData
  >(async (_previous, form) => (await action(form)) ?? null, null);

  return (
    <form action={formAction}>
      {children}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Working…" : submitLabel}
      </button>
      {state !== null && (
        <p
          className={state.ok ? "flash ok auth-flash" : "flash bad auth-flash"}
          role="status"
          aria-live="polite"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
