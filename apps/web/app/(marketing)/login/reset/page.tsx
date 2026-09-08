import type { Metadata } from "next";

import { requestPasswordReset } from "../../../../src/auth-actions.ts";
import { authConfigured } from "../../../../src/session.ts";
import { AuthForm } from "../../auth-form.tsx";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false },
};

export default function ResetPage() {
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>Reset your password</h1>
        <p className="auth-lede">
          We will email a link that signs you in and lets you set a new one.
        </p>

        {!authConfigured() && (
          <div className="notice">
            <b>Sign-in is not connected on this deployment yet.</b> Nothing will
            be sent.
          </div>
        )}

        <AuthForm action={requestPasswordReset} submitLabel="Send reset link">
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
        </AuthForm>

        <p className="auth-alt">
          Remembered it? <a href="/login">Log in</a>.
        </p>
      </div>
    </main>
  );
}
