/**
 * Searches list.
 *
 * A customer can run several searches at once — the schema has always allowed
 * it (`watches` is keyed on customer + name) and the pipeline polls each one
 * separately. This is the page that makes that visible: one search per place
 * you want watched, all judged against the same description of what you sell.
 */
import type { Metadata } from "next";

import { setWatchActive } from "../../../src/actions.ts";
import { planInfo } from "../../../src/plans.ts";
import { listWatches } from "../../../src/queries.ts";
import { requireCustomer } from "../../../src/session.ts";
import { ActionButton } from "../form.tsx";
import { IconPause, IconPlay, IconPlus, IconSearch } from "../icons.tsx";

export const metadata: Metadata = { title: "Searches" };
export const dynamic = "force-dynamic";

export default async function SearchesPage() {
  const customer = await requireCustomer();
  const watches = await listWatches(customer.id);
  const plan = planInfo(customer.plan);
  const running = watches.filter((w) => w.active).length;

  return (
    <main className="pane">
      <header className="pane-head">
        <div>
          <h1>Searches</h1>
          <p className="pane-sub">
            Each search watches its own sources with its own terms. They all
            share what you sell, so add one per place worth watching rather than
            widening a single search until it catches everything.
          </p>
        </div>
        <a className="btn btn-primary" href="/dashboard/searches/new">
          <IconPlus size={14} />
          New search
        </a>
      </header>

      {watches.length > 0 && (
        <p className="plan-usage">
          <span>
            <b>
              {running} of {plan.searches}
            </b>{" "}
            {plan.searches === 1 ? "search" : "searches"} running · {plan.name}
          </span>
          {running >= plan.searches && (
            <span>
              — pause one to start another
              {plan.tier === "starter" && ", or reply to any digest to move to Pro"}
            </span>
          )}
        </p>
      )}

      {watches.length === 0 ? (
        <div className="empty">
          <IconSearch size={28} />
          <h3>No searches yet.</h3>
          <p>
            A search is a set of terms plus the places to look. Nothing is polled
            until at least one exists.
          </p>
          <a className="btn btn-primary" href="/dashboard/searches/new">
            <IconPlus size={14} />
            Create your first search
          </a>
        </div>
      ) : (
        <ul className="watch-list">
          {watches.map((w) => (
            <li className={w.active ? "watch" : "watch paused"} key={w.id}>
              <div className="watch-main">
                <p className="watch-top">
                  <a className="watch-name" href={`/dashboard/searches/${w.id}`}>
                    {w.name}
                  </a>
                  {!w.active && <span className="badge-paused">Paused</span>}
                </p>
                <p className="watch-meta">
                  {w.sources.length === 0 ? "no sources" : w.sources.join(" · ")}
                  {" — "}
                  {w.includeTerms.length} include
                  {w.excludeTerms.length > 0 && `, ${w.excludeTerms.length} exclude`}
                </p>
                {w.includeTerms.length > 0 && (
                  <p className="watch-terms">
                    {w.includeTerms.slice(0, 6).map((t) => (
                      <span className="term" key={t}>
                        {t}
                      </span>
                    ))}
                    {w.includeTerms.length > 6 && (
                      <span className="term more">
                        +{w.includeTerms.length - 6} more
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="watch-side">
                <p className="watch-count">
                  <b>{w.leadCount}</b>
                  <span>leads / 7d</span>
                </p>
                <div className="watch-buttons">
                  <a className="btn btn-sm" href={`/dashboard/searches/${w.id}`}>
                    Edit
                  </a>
                  <ActionButton
                    action={setWatchActive}
                    fields={{ id: w.id, active: String(!w.active) }}
                    icon={w.active ? <IconPause size={13} /> : <IconPlay size={13} />}
                    label={w.active ? "Pause" : "Resume"}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
