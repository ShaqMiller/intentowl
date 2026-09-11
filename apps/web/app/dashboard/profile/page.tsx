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
import { IconAlert, IconTag, IconTarget } from "../icons.tsx";
import { Tabs } from "../tabs.tsx";

export const metadata: Metadata = { title: "What you sell" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const customer = await requireCustomer();
  const profile = await getProfile(customer.id);

  const product = (
    <>
      <SettingCard
        icon={<IconTarget />}
        title="What the product does"
        hint="Write it the way you would explain it to a peer, not the way you would put it on a pricing page. The most useful sentence is usually the one describing what people do instead of using you — that is the situation the classifier looks for in a thread."
        footer="Applies from the next classification run."
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
        title="Who it is for"
        hint="Stage, company shape, and how technical they are. This is what separates a founder who would buy from one who is merely interested."
        footer="Applies from the next classification run."
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
        title="Competitors"
        hint="One per line. Someone complaining about one of these by name is the strongest buying signal there is — and these names work as search terms on their own."
        footer={`${profile?.competitors.length ?? 0} listed.`}
        action={updateProfile}
      >
        <textarea
          id="competitors"
          name="competitors"
          rows={5}
          defaultValue={(profile?.competitors ?? []).join("\n")}
          placeholder={"Mixpanel\nAmplitude\nPostHog"}
        />
      </SettingCard>

      <SettingCard
        icon={<IconAlert />}
        title="Definitely not a customer"
        hint="One per line. This does more for precision than anything else on the page — it is what stops plausible-but-useless leads reaching your inbox."
        footer={`${profile?.disqualifiers.length ?? 0} listed.`}
        action={updateProfile}
      >
        <textarea
          id="disqualifiers"
          name="disqualifiers"
          rows={5}
          defaultValue={(profile?.disqualifiers ?? []).join("\n")}
          placeholder={"students looking for free tools\nenterprises needing SOC 2"}
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
            Every post that survives your search terms is judged against this.
            It is the difference between leads that are yours and leads that are
            merely about your category.
          </p>
        </div>
      </header>

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
