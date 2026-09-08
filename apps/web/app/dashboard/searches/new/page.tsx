import type { Metadata } from "next";

import { createWatch } from "../../../../src/actions.ts";
import { requireCustomer } from "../../../../src/session.ts";
import { ActionForm } from "../../form.tsx";
import { WatchFields } from "../watch-fields.tsx";

export const metadata: Metadata = { title: "New search" };

export default async function NewSearchPage() {
  // Not used on the page, but it enforces the session before rendering a form
  // that writes to the database.
  await requireCustomer();

  return (
    <main className="pane narrow-pane">
      <header className="pane-head">
        <div>
          <p className="crumb">
            <a href="/dashboard/searches">Searches</a> / New
          </p>
          <h1>New search</h1>
          <p className="pane-sub">
            Polling starts within a few minutes of saving. The first digest that
            includes it is the next scheduled one.
          </p>
        </div>
      </header>

      <ActionForm action={createWatch} submitLabel="Create search" className="card-form">
        <WatchFields defaults={{ sources: ["hn", "lobsters"] }} />
      </ActionForm>
    </main>
  );
}
