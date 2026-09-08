/**
 * Sign in.
 *
 * The error messages here are deliberately unhelpful about *which* half was
 * wrong. A form that distinguishes "no such account" from "wrong password"
 * tells anyone who asks whether a given founder is paying for IntentOwl.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { signIn } from "../../../src/auth-actions.ts";
import { authConfigured, getCustomer } from "../../../src/session.ts";
import { AuthForm } from "../auth-form.tsx";

export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  link: "That link was not valid. Request a new one below.",
  expired: "That link has expired or was already used. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Already signed in? Skip the form.
  const existing = await getCustomer();
  if (existing !== null && !existing.impersonated) redirect("/dashboard");

  const params = await searchParams;
  const errorKey = typeof params["error"] === "string" ? params["error"] : null;
  const notice = errorKey === null ? null : (ERRORS[errorKey] ?? null);

  return (
    <main className="auth">
      <div className="auth-card">
        <h1>Log in</h1>
        <p className="auth-lede">
          Your leads live in the digest; this is where you tune what finds them.
        </p>

        {!authConfigured() && (
          <div className="notice">
            <b>Sign-in is not connected on this deployment.</b> The form below
            is wired to the real action and starts working as soon as Supabase
            is configured — until then it refuses rather than pretending.
          </div>
        )}

        {notice !== null && <div className="notice">{notice}</div>}

        <AuthForm action={signIn} submitLabel="Log in">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
        </AuthForm>

        <p className="auth-alt">
          First time here? <a href="/login/claim">Set your password</a> ·{" "}
          <a href="/login/reset">Forgot it?</a>
        </p>
        <p className="auth-alt">
          Not a customer yet? <a href="/signup">See the plans</a>.
        </p>
      </div>
    </main>
  );
}
