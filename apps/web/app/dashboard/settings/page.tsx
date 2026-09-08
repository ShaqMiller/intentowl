/**
 * Settings: delivery, security, billing.
 *
 * The timezone and hour are stored as the customer asked for them — a local
 * hour plus an IANA zone — never as a precomputed UTC hour. The offset between
 * the two moves twice a year on different dates in different countries, so a
 * UTC hour would drift by an hour every spring without anyone touching it.
 */
import type { Metadata } from "next";

import { updateDelivery } from "../../../src/actions.ts";
import { changePassword, signOutEverywhere } from "../../../src/auth-actions.ts";
import { authConfigured, requireCustomer } from "../../../src/session.ts";
import { ActionButton, ActionForm } from "../form.tsx";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

/** A short list of common zones, plus whatever the customer already has. */
const COMMON_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default async function SettingsPage() {
  const customer = await requireCustomer();
  const zones = [...new Set([customer.tz, ...COMMON_ZONES])];

  return (
    <main className="pane narrow-pane">
      <header className="pane-head">
        <div>
          <h1>Settings</h1>
          <p className="pane-sub">Delivery, security and billing.</p>
        </div>
      </header>

      <section className="settings-block">
        <h2>Delivery</h2>
        <ActionForm action={updateDelivery} submitLabel="Save delivery" className="card-form">
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              name="name"
              type="text"
              defaultValue={customer.name ?? ""}
              placeholder="How the digest should address you"
              maxLength={120}
            />
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={customer.email} disabled readOnly />
            <p className="hint">
              The digest goes here. Changing it moves your billing identity too,
              so reply to any digest and I will change it by hand.
            </p>
          </div>

          <div className="row-2">
            <div className="field">
              <label htmlFor="tz">Timezone</label>
              <select id="tz" name="tz" defaultValue={customer.tz}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="digestHour">Send at</label>
              <select
                id="digestHour"
                name="digestHour"
                defaultValue={String(customer.digestHour)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="hint">
            Local to the zone above, and it stays correct across daylight saving
            changes.
          </p>
        </ActionForm>
      </section>

      <section className="settings-block">
        <h2>Password</h2>
        {!authConfigured() && (
          <div className="notice">
            <b>Sign-in is not connected on this deployment.</b> This form is
            wired to the real action and starts working as soon as Supabase is
            configured — until then it refuses rather than pretending.
          </div>
        )}
        <ActionForm
          action={changePassword}
          submitLabel="Change password"
          className="card-form"
        >
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              placeholder="At least 12 characters"
            />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
            />
          </div>
        </ActionForm>
      </section>

      <section className="settings-block">
        <h2>Sessions</h2>
        <div className="note-card">
          <h3>Lost a device?</h3>
          <p>
            This signs out every other browser and device, and leaves this one
            signed in — so you do not have to prove yourself again from the one
            machine you still trust. Anyone holding an old session is dropped
            immediately.
          </p>
          <p style={{ marginTop: 14 }}>
            <ActionButton
              action={signOutEverywhere}
              fields={{}}
              label="Sign out everywhere else"
            />
          </p>
        </div>
      </section>

      <section className="settings-block">
        <h2>Billing</h2>
        <div className="note-card">
          <h3>
            {customer.plan ?? "Concierge"} · {customer.status}
          </h3>
          <p>
            Subscriptions are managed in Stripe. To change plan or cancel, use
            the link at the bottom of any digest, or reply to it and I will do it
            for you. A self-serve billing portal arrives with sign-in.
          </p>
        </div>
      </section>
    </main>
  );
}
