/**
 * "What you sell" — the classification profile.
 *
 * Its own page rather than a settings tab because it is the single biggest
 * lever on result quality: the classifier judges every surviving post against
 * this text, and a vague paragraph here produces vague leads no amount of
 * search-term tuning will fix.
 */
import type { Metadata } from "next";

import { updateProfile } from "../../../src/actions.ts";
import { getProfile } from "../../../src/queries.ts";
import { requireCustomer } from "../../../src/session.ts";
import { ActionForm } from "../form.tsx";

export const metadata: Metadata = { title: "What you sell" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const customer = await requireCustomer();
  const profile = await getProfile(customer.id);

  return (
    <main className="pane narrow-pane">
      <header className="pane-head">
        <div>
          <h1>What you sell</h1>
          <p className="pane-sub">
            Every post that survives the search terms is judged against this.
            Write it the way you would explain the product to a peer, not the
            way you would put it on a pricing page.
          </p>
        </div>
      </header>

      <ActionForm action={updateProfile} submitLabel="Save profile" className="card-form">
        <div className="field">
          <label htmlFor="productDesc">What the product does</label>
          <textarea
            id="productDesc"
            name="productDesc"
            rows={6}
            defaultValue={profile?.productDesc ?? ""}
            placeholder="A paragraph. What it does, what problem it removes, and what someone was doing before they had it."
          />
          <p className="hint">
            The most useful sentence is usually the one describing what people do
            instead of using you — that is the situation the classifier is
            looking for in a thread.
          </p>
        </div>

        <div className="field">
          <label htmlFor="icpDesc">Who it is for</label>
          <textarea
            id="icpDesc"
            name="icpDesc"
            rows={4}
            defaultValue={profile?.icpDesc ?? ""}
            placeholder="Who gets value from this, at what stage, in what kind of company."
          />
        </div>

        <div className="field">
          <label htmlFor="competitors">Competitors</label>
          <textarea
            id="competitors"
            name="competitors"
            rows={3}
            defaultValue={(profile?.competitors ?? []).join("\n")}
            placeholder={"Acme\nBetterTool"}
          />
          <p className="hint">
            One per line. Someone complaining about one of these by name is one
            of the strongest signals there is.
          </p>
        </div>

        <div className="field">
          <label htmlFor="disqualifiers">Definitely not a customer</label>
          <textarea
            id="disqualifiers"
            name="disqualifiers"
            rows={3}
            defaultValue={(profile?.disqualifiers ?? []).join("\n")}
            placeholder={"students looking for free tools\nenterprises needing SOC 2"}
          />
          <p className="hint">
            One per line. This does more for precision than anything else on the
            page — it is what stops plausible-but-useless leads.
          </p>
        </div>
      </ActionForm>

      <div className="note-card">
        <h3>Refining this against real results</h3>
        <p>
          Editing this text changes what gets classified from the next run
          onward, but it cannot tell you whether the change was an improvement.
          A dry-run — re-judging the last few hundred posts against a draft
          before saving it, so you can see what it would have caught — is the
          next thing being built here.
        </p>
      </div>
    </main>
  );
}
