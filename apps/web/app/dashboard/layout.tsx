/**
 * Dashboard shell.
 *
 * Sidebar rather than a top nav: this is a tool people work in, not a page they
 * read, and the section they are in should stay visible while they scroll a
 * long leads feed.
 */
import type { ReactNode } from "react";

import "./dashboard.css";

import { OwlMark } from "../(marketing)/chrome.tsx";
import { getCustomer } from "../../src/session.ts";
import { SideNav } from "./nav.tsx";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const customer = await getCustomer();

  if (customer === null) {
    return (
      <main className="auth">
        <div className="auth-card">
          <h1>Not signed in</h1>
          <p className="auth-lede">
            The dashboard needs an account. Sign-in is not connected yet — see
            the note on the login page.
          </p>
          <a className="btn" href="/login">
            Back to log in
          </a>
        </div>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className="side">
        <a className="brand side-brand" href="/">
          <OwlMark />
          IntentOwl
        </a>

        <SideNav />

        <div className="side-foot">
          <p className="side-email" title={customer.email}>
            {customer.email}
          </p>
          <p className="side-plan">
            {customer.plan ?? "concierge"} · {customer.status}
          </p>
        </div>
      </aside>

      <div className="main">
        {customer.impersonated && (
          <div className="impersonation">
            <b>Development session.</b> You are seeing {customer.email} without
            signing in. This path is refused in production.
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
