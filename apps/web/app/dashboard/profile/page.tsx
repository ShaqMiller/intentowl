/**
 * "What you sell" — the classification profile.
 *
 * Its own page rather than a settings tab because it is the single biggest
 * lever on result quality: the classifier judges every surviving post against
 * this text, and a vague paragraph here produces vague leads no amount of
 * search-term tuning will fix.
 *
 * Laid out as one card per decision, each saving independently. A single form
 * with one button at the bottom made four unrelated judgements feel like a
 * chore to get through; this way each one states its own consequence and can
 * be changed on its own.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { updateProfile } from "../../../src/actions.ts";
import { getProfile } from "../../../src/queries.ts";
import { requireCustomer } from "../../../src/session.ts";
import { ActionForm } from "../form.tsx";
import { TagInput } from "../tag-input.tsx";
import { IconAlert, IconTag, IconTarget } from "../icons.tsx";
import { Tabs } from "../tabs.tsx";

export const metadata: Metadata = { title: "What you sell" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const customer = await requireCustomer();
  const profile = await getProfile(customer.id);

  // Four separate judgements, four saves — so say how far through they are,
  // which one button at the bottom of a single form would have shown for free.
  const filled = [
    (profile?.productDesc ?? "") !== "",
    (profile?.icpDesc ?? "") !== "",
    (profile?.competitors.length ?? 0) > 0,
    (profile?.disqualifiers.length ?? 0) > 0,
  ].filter(Boolean).length;

  const product = (
    <>
      <SettingCard
        icon={<IconTarget />}
        title="What does your product do?"
        hint="Plain words, the way you would explain it to another founder. The most useful sentence is usually what people do instead of using you — that is the moment we look for in a thread."
        footer="Takes effect within the hour."
        action={updateProfile}
      >
        <textarea
          id="productDesc"
          name="productDesc"
          rows={6}
          defaultValue={profile?.productDesc ?? ""}
          placeholder="What it does, what problem it removes, and what someone was doing before they had it."
        />
      </SettingCard>

      <SettingCard
        icon={<IconTarget />}
        title="Who buys it?"
        hint="Stage, company shape, how technical. This is what separates someone who would buy from someone who is merely interested."
        footer="Takes effect within the hour."
        action={updateProfile}
      >
        <textarea
          id="icpDesc"
          name="icpDesc"
          rows={5}
          defaultValue={profile?.icpDesc ?? ""}
          placeholder="Who gets value from this, at what stage, in what kind of company."
        />
      </SettingCard>
    </>
  );

  const signals = (
    <>
      <SettingCard
        icon={<IconTag />}
        title="Who do you compete with?"
        hint="Someone complaining about one of these by name is the strongest buying signal there is."
        footer={`${profile?.competitors.length ?? 0} listed.`}
        action={updateProfile}
      >
        <TagInput
          name="competitors"
          label="Competitors"
          defaultValue={profile?.competitors ?? []}
          placeholder="Mixpanel"
        />
      </SettingCard>

      <SettingCard
        icon={<IconAlert />}
        title="Who isn&apos;t a fit?"
        hint="This does more for precision than anything else here: it keeps the near-misses out of your inbox."
        footer={`${profile?.disqualifiers.length ?? 0} listed.`}
        action={updateProfile}
      >
        <TagInput
          name="disqualifiers"
          label="Not a customer"
          defaultValue={profile?.disqualifiers ?? []}
          placeholder="students looking for free tools"
        />
      </SettingCard>
    </>
  );

  return (
    <main className="pane">
      <header className="pane-head">
        <div>
          <h1>What you sell</h1>
          <p className="pane-sub">
            Every post that gets past your search words is judged against this.
            It decides whether a lead is yours or just about your category.
          </p>
        </div>
      </header>

      <p className="plan-usage">
        <span>
          <b>
            {filled} of 4
          </b>{" "}
          filled in
        </span>
        {filled < 4 && <span>— the emptier this is, the more near-misses you get</span>}
      </p>

      <Tabs
        tabs={[
          { id: "product", label: "The product", icon: <IconTarget />, content: product },
          { id: "signals", label: "Signals and exclusions", icon: <IconTag />, content: signals },
        ]}
      />
    </main>
  );
}

/**
 * One setting, one card, one save.
 *
 * The footer carries the consequence on the left and the action on the right,
 * so a change is never committed without saying what it will do.
 */
function SettingCard({
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
          <div className="field">{children}</div>
        </div>
      </ActionForm>
    </div>
  );
}
