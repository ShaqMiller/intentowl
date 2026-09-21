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
import { TIERS, planInfo } from "../../src/plans.ts";
import { listWatches } from "../../src/queries.ts";
import { authConfigured, getCustomer } from "../../src/session.ts";
import { IconSignOut } from "./icons.tsx";
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

  // For the plan card: how much of the plan's search allowance is in use.
  // Same count the Searches page shows, so the two can never disagree.
  const plan = planInfo(customer.plan);
  const running = (await listWatches(customer.id)).filter((w) => w.active).length;
  const used = Math.min(1, running / plan.searches);

  return (
    <div className="shell">
      <aside className="side">
        <a className="brand side-brand" href="/">
          <OwlMark />
          IntentOwl
        </a>

        <SideNav />

        <div className="side-plan-card">
          <p className="side-plan">
            {plan.name} plan · {customer.status}
          </p>
          <p className="side-plan-usage">
            {running} of {plan.searches} {plan.searches === 1 ? "search" : "searches"} running
          </p>
          <div className="side-meter" aria-hidden="true">
            <span style={{ width: `${used * 100}%` }} />
          </div>
          {plan.tier === "starter" && (
            <a className="side-upgrade" href="/dashboard/settings">
              Get up to {TIERS.pro.searches} with Pro
            </a>
          )}
        </div>

        <div className="side-foot">
          <span className="side-avatar" aria-hidden="true">
            {customer.email.slice(0, 2).toUpperCase()}
          </span>
          <div className="side-who">
            <p className="side-email" title={customer.email}>
              {customer.email}
            </p>
            {authConfigured() && (
              <form action={signOut} className="side-signout">
                <button type="submit">
                  <IconSignOut size={13} />
                  Sign out
                </button>
              </form>
            )}
          </div>
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
