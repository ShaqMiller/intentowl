/**
 * Dashboard shell.
 *
 * Sidebar rather than a top nav: this is a tool people work in, not a page they
 * read, and the section they are in should stay visible while they scroll a
 * long leads feed.
 */
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import "./dashboard.css";

import { OwlMark } from "../(marketing)/chrome.tsx";
import { signOut } from "../../src/auth-actions.ts";
import { authConfigured, getCustomer } from "../../src/session.ts";
import { SideNav } from "./nav.tsx";

/**
 * Nothing under /dashboard may be statically prerendered.
 *
 * Every page here is per-customer and behind a session, so a build-time render
 * is meaningless at best and a cached view of someone's leads at worst. Set on
 * the layout so it covers the whole subtree — a page added later inherits it
 * instead of having to remember.
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const customer = await getCustomer();

  // Signed out, or signed in with no customer row behind the account. Both
  // mean "no dashboard for you", and the login page explains the difference.
  if (customer === null) redirect("/login");

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
          {authConfigured() && (
            <form action={signOut} className="side-signout">
              <button type="submit">Sign out</button>
            </form>
          )}
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
