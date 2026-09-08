/**
 * Set a password for the first time.
 *
 * Payment creates the customer row long before an account exists, so this is
 * the step that joins the two. It deliberately does not check whether the
 * email belongs to a customer: answering that question would turn this page
 * into a way to find out who is paying. Instead the confirmation email is sent
 * either way, and the link in it only resolves to a dashboard if there is a
 * customer row to claim.
 */
import type { Metadata } from "next";

import { claimAccount } from "../../../../src/auth-actions.ts";
import { authConfigured } from "../../../../src/session.ts";
import { AuthForm } from "../../auth-form.tsx";

export const metadata: Metadata = {
  title: "Set your password",
  robots: { index: false },
};

export default function ClaimPage() {
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>Set your password</h1>
        <p className="auth-lede">
          For customers who have paid but never signed in. Use the same address
          your digest arrives at.
        </p>

        {!authConfigured() && (
          <div className="notice">
            <b>Sign-in is not connected on this deployment yet.</b> Nothing will
            be sent.
          </div>
        )}

        <AuthForm action={claimAccount} submitLabel="Send confirmation email">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="the address your digest goes to"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              placeholder="At least 12 characters"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </div>
        </AuthForm>

        <p className="auth-alt">
          Already set one? <a href="/login">Log in</a>.
        </p>
      </div>
    </main>
  );
}
