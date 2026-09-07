/**
 * Log in.
 *
 * There is no auth system yet — accounts and a web dashboard are M7. Rather
 * than render a form that silently does nothing when you press it, this page
 * says plainly how access works today (the digest is the product; it arrives
 * by email) and keeps the input disabled until there is something behind it.
 *
 * A convincing-looking login box that swallows a password would be the single
 * most damaging thing on this site.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false },
};

export default function LoginPage() {
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>Log in</h1>
        <p className="auth-lede">
          IntentOwl delivers to your inbox, not to a dashboard.
        </p>

        <div className="notice">
          <b>There is nothing to log in to yet.</b> Every customer is set up by
          hand and every lead arrives in the 7am digest. Accounts and a web
          archive are the next thing being built — until then, the fastest way
          to reach your leads is to open this morning&rsquo;s email.
        </div>

        <div className="field">
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            disabled
          />
        </div>

        <button className="btn" type="button" disabled>
          Email me a sign-in link
        </button>

        <p className="auth-alt">
          Not a customer yet? <a href="/signup">See the plans</a>.
        </p>
      </div>
    </main>
  );
}
