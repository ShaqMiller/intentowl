/**
 * Settings: delivery, security, billing.
 *
 * The timezone and hour are stored as the customer asked for them — a local
 * hour plus an IANA zone — never as a precomputed UTC hour. The offset between
 * the two moves twice a year on different dates in different countries, so a
 * UTC hour would drift by an hour every spring without anyone touching it.
 *
 * Split into tabs, one card per decision, each saving on its own. Security and
 * billing have nothing to do with when the digest arrives, and stacking them
 * down one page implied they did.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { updateDelivery } from "../../../src/actions.ts";
import { changePassword, signOutEverywhere } from "../../../src/auth-actions.ts";
import { authConfigured, requireCustomer } from "../../../src/session.ts";
import { ActionButton, ActionForm } from "../form.tsx";
import {
  IconCard,
  IconClock,
  IconLock,
  IconMail,
  IconSignOut,
} from "../icons.tsx";
import { Tabs } from "../tabs.tsx";

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
  const hour = String(customer.digestHour).padStart(2, "0");

  const delivery = (
    <>
      <Card
        icon={<IconClock />}
        title="When the digest arrives"
        hint="Local to the zone you pick, and it stays correct across daylight saving changes — the hour is stored as the hour you asked for, not as a UTC time that drifts every spring."
        footer={`Currently ${hour}:00 ${customer.tz}. Takes effect from the next schedule sync.`}
        action={updateDelivery}
      >
        <div className="grid2">
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
      </Card>

      <Card
        icon={<IconMail />}
        title="Who it is addressed to"
        hint="The name the digest greets you by. Your email address is the one the digest is sent to and the one your billing is tied to — reply to any digest to change it and I will move both together."
        footer={customer.email}
        action={updateDelivery}
      >
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
      </Card>
    </>
  );

  const security = (
    <>
      {!authConfigured() && (
        <div className="notice">
          <b>Sign-in is not connected on this deployment.</b> These forms are
          wired to the real actions and start working as soon as Supabase is
          configured — until then they refuse rather than pretending.
        </div>
      )}

      <Card
        icon={<IconLock />}
        title="Password"
        hint="At least twelve characters. Changing it here does not sign out your other devices — use the card below for that."
        footer="You will stay signed in on this device."
        action={changePassword}
      >
        <div className="grid2">
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
            <label htmlFor="confirm">Confirm</label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
            />
          </div>
        </div>
      </Card>

      <div className="setcard">
        <div className="setcard-body">
          <div className="setcard-head">
            <IconSignOut />
            <h3>Lost a device?</h3>
          </div>
          <p className="hint">
            Signs out every other browser and device and leaves this one signed
            in, so you do not have to prove yourself again from the machine you
            still trust. Anyone holding an old session is dropped immediately.
          </p>
        </div>
        <div className="setcard-foot">
          <span>This device keeps its session.</span>
          <ActionButton
            action={signOutEverywhere}
            fields={{}}
            icon={<IconSignOut size={13} />}
            label="Sign out everywhere else"
          />
        </div>
      </div>
    </>
  );

  const billing = (
    <div className="setcard">
      <div className="setcard-body">
        <div className="setcard-head">
          <IconCard />
          <h3>
            {customer.plan ?? "Concierge"} · {customer.status}
          </h3>
        </div>
        <p className="hint">
          Subscriptions are managed in Stripe. To change plan or cancel, use the
          link at the bottom of any digest, or reply to it and I will do it for
          you. A self-serve billing portal is coming.
        </p>
      </div>
      <div className="setcard-foot">
        <span>Billed to {customer.email}.</span>
      </div>
    </div>
  );

  return (
    <main className="pane">
      <header className="pane-head">
        <div>
          <h1>Settings</h1>
          <p className="pane-sub">Delivery, security and billing.</p>
        </div>
      </header>

      <Tabs
        tabs={[
          { id: "delivery", label: "Delivery", icon: <IconMail />, content: delivery },
          { id: "security", label: "Security", icon: <IconLock />, content: security },
          { id: "billing", label: "Billing", icon: <IconCard />, content: billing },
        ]}
      />
    </main>
  );
}

function Card({
  icon,
  title,
  hint,
  footer,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  footer: string;
  action: (form: FormData) => Promise<{ ok: boolean; message: string }>;
  children: ReactNode;
}) {
  return (
    <div className="setcard">
      <ActionForm action={action} submitLabel="Save" variant="card" footer={footer}>
        <div className="setcard-body">
          <div className="setcard-head">
            {icon}
            <h3>{title}</h3>
          </div>
          <p className="hint">{hint}</p>
          {children}
        </div>
      </ActionForm>
    </div>
  );
}
