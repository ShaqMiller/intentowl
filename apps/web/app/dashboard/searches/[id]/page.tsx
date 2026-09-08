import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { updateWatch } from "../../../../src/actions.ts";
import { getWatch } from "../../../../src/queries.ts";
import { requireCustomer } from "../../../../src/session.ts";
import { ActionForm } from "../../form.tsx";
import { WatchFields } from "../watch-fields.tsx";

export const metadata: Metadata = { title: "Edit search" };
export const dynamic = "force-dynamic";

export default async function EditSearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const customer = await requireCustomer();
  const { id } = await params;

  // getWatch scopes by customer, so someone else's id is indistinguishable from
  // one that does not exist — which is the correct thing to tell them.
  const watch = await getWatch(customer.id, id);
  if (watch === null) notFound();

  return (
    <main className="pane narrow-pane">
      <header className="pane-head">
        <div>
          <p className="crumb">
            <a href="/dashboard/searches">Searches</a> / {watch.name}
          </p>
          <h1>Edit search</h1>
          <p className="pane-sub">
            Changes apply to the next poll. Leads already found keep the name
            they were found under.
          </p>
        </div>
        <a className="btn" href={`/dashboard?watch=${watch.id}`}>
          View its leads
        </a>
      </header>

      <ActionForm action={updateWatch} submitLabel="Save changes" className="card-form">
        <WatchFields
          defaults={{
            id: watch.id,
            name: watch.name,
            sources: watch.sources,
            includeTerms: watch.includeTerms,
            excludeTerms: watch.excludeTerms,
            subreddits: watch.subreddits,
            feeds: feedsOf(watch.sourceConfig),
            active: watch.active,
          }}
        />
      </ActionForm>

      <p className="note-inline">
        There is no delete. Removing a search would cascade to its lead history,
        which cost real money to classify — pause it instead.
      </p>
    </main>
  );
}

/**
 * Read RSS feed URLs out of the per-source jsonb.
 *
 * Defensive because `sourceConfig` is untyped storage: a row written by an
 * older shape, or by hand, must render an empty field rather than crash the
 * editor.
 */
function feedsOf(config: unknown): string[] {
  if (typeof config !== "object" || config === null) return [];
  const rss = (config as { rss?: unknown }).rss;
  if (typeof rss !== "object" || rss === null) return [];
  const feeds = (rss as { feeds?: unknown }).feeds;
  if (!Array.isArray(feeds)) return [];
  return feeds.filter((f): f is string => typeof f === "string");
}
