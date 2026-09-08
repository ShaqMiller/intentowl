/**
 * Leads feed — the page people open every morning.
 *
 * Deliberately the same information the digest email carries, in the same
 * order. Two views of one thing that disagree is how you lose trust in both.
 */
import type { Metadata } from "next";

import { listLeads, listWatches, getStats } from "../../src/queries.ts";
import { requireCustomer } from "../../src/session.ts";

export const metadata: Metadata = { title: "Leads" };

// Always fresh: a feed that serves yesterday's leads from cache is worse than
// a slow one.
export const dynamic = "force-dynamic";

const INTENTS: Array<{ key: string; label: string }> = [
  { key: "buying_intent", label: "Buying intent" },
  { key: "competitor_switch", label: "Leaving a competitor" },
  { key: "pain_point", label: "Describing the pain" },
  { key: "research", label: "Researching" },
];

function intentLabel(key: string): string {
  return INTENTS.find((i) => i.key === key)?.label ?? key.replace(/_/g, " ");
}

function ago(date: Date | null): string {
  if (date === null) return "unknown";
  const hours = Math.floor((Date.now() - date.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const customer = await requireCustomer();
  const params = await searchParams;

  const watchParam = typeof params["watch"] === "string" ? params["watch"] : undefined;
  const intentParam = typeof params["intent"] === "string" ? params["intent"] : undefined;

  const [watches, stats, leads] = await Promise.all([
    listWatches(customer.id),
    getStats(customer.id),
    listLeads(customer.id, { watchId: watchParam, intent: intentParam, days: 7 }),
  ]);

  const filtered = watchParam !== undefined || intentParam !== undefined;

  return (
    <main className="pane">
      <header className="pane-head">
        <div>
          <h1>Leads</h1>
          <p className="pane-sub">
            Last seven days, highest scoring first. Your digest goes out at{" "}
            {String(customer.digestHour).padStart(2, "0")}:00 {customer.tz}.
          </p>
        </div>
      </header>

      <div className="stats">
        <Stat label="Leads, 24h" value={stats.leads24h} />
        <Stat label="Leads, 7d" value={stats.leads7d} />
        <Stat label="Posts read, 24h" value={stats.scanned24h} />
        <Stat label="Active searches" value={stats.activeWatches} />
      </div>

      <div className="filters">
        <FilterLink label="All searches" href="/dashboard" on={!filtered} />
        {watches.map((w) => (
          <FilterLink
            key={w.id}
            label={w.name}
            href={`/dashboard?watch=${w.id}`}
            on={watchParam === w.id}
          />
        ))}
        <span className="filter-divider" aria-hidden="true" />
        {INTENTS.map((i) => (
          <FilterLink
            key={i.key}
            label={i.label}
            href={`/dashboard?intent=${i.key}`}
            on={intentParam === i.key}
          />
        ))}
      </div>

      {leads.length === 0 ? (
        <div className="empty">
          <h3>Nothing here yet.</h3>
          <p>
            {watches.length === 0
              ? "You have no searches set up. Create one and the pollers will start reading within a few minutes."
              : filtered
                ? "No leads match that filter in the last seven days. Try clearing it."
                : "No leads in the last seven days. If that keeps up, the search terms are probably too narrow — that is worth fixing rather than waiting out."}
          </p>
          <a className="btn" href="/dashboard/searches">
            {watches.length === 0 ? "Create a search" : "Review your searches"}
          </a>
        </div>
      ) : (
        <ol className="feed">
          {leads.map((lead) => (
            <li className="feed-item" key={lead.itemId}>
              <div className="score">{lead.score}</div>
              <div className="feed-body">
                <p className="feed-meta">
                  <span className="chip">{intentLabel(lead.intent)}</span>
                  <span>{lead.venue ?? lead.source}</span>
                  <span>·</span>
                  <span>{lead.author ?? "unknown"}</span>
                  <span>·</span>
                  <span>{ago(lead.postedAt)}</span>
                  <span>·</span>
                  <span className="feed-watch">{lead.watchName}</span>
                </p>
                <h3 className="feed-title">
                  <a href={lead.url} target="_blank" rel="noreferrer noopener">
                    {lead.title ?? "(untitled post)"}
                  </a>
                </h3>
                {lead.reason !== null && <p className="feed-why">{lead.reason}</p>}
                {lead.replyAngle !== null && (
                  <p className="feed-angle">
                    <b>Angle</b>
                    {lead.replyAngle}
                  </p>
                )}
                <p className="feed-actions">
                  <a
                    className="btn btn-sm"
                    href={lead.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open thread
                  </a>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <p className="stat-value">{value.toLocaleString()}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}

function FilterLink({
  label,
  href,
  on,
}: {
  label: string;
  href: string;
  on: boolean;
}) {
  return (
    <a className={on ? "filter on" : "filter"} href={href}>
      {label}
    </a>
  );
}
