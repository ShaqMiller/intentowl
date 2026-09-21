/**
 * Leads feed — the page people open every morning.
 *
 * Deliberately the same information the digest email carries, in the same
 * order. Two views of one thing that disagree is how you lose trust in both.
 */
import { leadHeadline } from "@intentowl/core";
import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { getProfile, listLeads, listWatches, getStats } from "../../src/queries.ts";
import { requireCustomer } from "../../src/session.ts";
import { Owl } from "../owl.tsx";
import { IconExternal } from "./icons.tsx";
import { RateLead } from "./rate.tsx";

export const metadata: Metadata = { title: "Leads" };

// Always fresh: a feed that serves yesterday's leads from cache is worse than
// a slow one.
export const dynamic = "force-dynamic";

// `tone` picks the chip colour: lilac for asking, sky for pain, honey for
// weighing options, plain for everything quieter.
const INTENTS: Array<{ key: string; label: string; tone: string }> = [
  { key: "buying_intent", label: "Buying intent", tone: "intent-tool" },
  { key: "competitor_switch", label: "Leaving a competitor", tone: "intent-compare" },
  { key: "pain_point", label: "Describing the pain", tone: "intent-pain" },
  { key: "research", label: "Researching", tone: "intent-plain" },
];

function intentTone(key: string): string {
  return INTENTS.find((i) => i.key === key)?.tone ?? "intent-plain";
}

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

  const [watches, stats, leads, profile] = await Promise.all([
    listWatches(customer.id),
    getStats(customer.id),
    listLeads(customer.id, { watchId: watchParam, intent: intentParam, days: 7 }),
    getProfile(customer.id),
  ]);

  // Nothing to show until there is something to judge posts against and
  // somewhere to look. Setup takes three minutes; an empty feed teaches nothing.
  if (watches.length === 0 && (profile?.productDesc ?? null) === null) {
    redirect("/dashboard/welcome" as Route);
  }
  const welcome = params["welcome"] === "1";

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

      {welcome && (
        <div className="notice welcome-notice" role="status">
          <b>Your search is running.</b> The first poll looks back a week, so
          posts usually start appearing within the hour. Your first digest
          arrives tomorrow at {String(customer.digestHour).padStart(2, "0")}:00
          {" "}{customer.tz}. Rate leads as they come in — it teaches the
          classifier what you mean by a good one.
        </div>
      )}

      <div className="stats">
        <Stat label="Leads, 24h" value={stats.leads24h} lead />
        <Stat label="Leads, 7d" value={stats.leads7d} />
        <Stat label="Posts read, 24h" value={stats.scanned24h} />
        <Stat label="Active searches" value={stats.activeWatches} />
      </div>

      <div className="filters">
        <FilterLink label="All searches" href="/dashboard" on={!filtered} kind="filter-watch" />
        {watches.map((w) => (
          <FilterLink
            key={w.id}
            label={w.name}
            href={`/dashboard?watch=${w.id}`}
            on={watchParam === w.id}
            kind="filter-watch"
          />
        ))}
        <span className="filter-divider" aria-hidden="true" />
        {INTENTS.map((i) => (
          <FilterLink
            key={i.key}
            label={i.label}
            href={`/dashboard?intent=${i.key}`}
            on={intentParam === i.key}
            kind={`filter-intent ${i.tone}`}
          />
        ))}
      </div>

      {leads.length === 0 ? (
        <div className="empty">
          <Owl mood="sleepy" size={96} />
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
              <div className={lead.score >= 90 ? "score" : "score soft"}>
                <b>{lead.score}</b>
                <span>Score</span>
              </div>
              <div className="feed-body">
                <p className="feed-meta">
                  <span className={`intent ${intentTone(lead.intent)}`}>
                    {intentLabel(lead.intent)}
                  </span>
                  <span className="feed-venue">{lead.venue ?? lead.source}</span>
                  <span>·</span>
                  <span>{lead.author ?? "unknown"}</span>
                  <span>·</span>
                  <span>{ago(lead.postedAt)}</span>
                  <span>·</span>
                  <span className="feed-watch">{lead.watchName}</span>
                </p>
                <h3 className="feed-title">
                  <a href={lead.url} target="_blank" rel="noreferrer noopener">
                    {leadHeadline(lead)}
                  </a>
                </h3>
                {lead.reason !== null && (
                  <p className="feed-why">
                    <b>Why it matters:</b> {lead.reason}
                  </p>
                )}
                {lead.replyAngle !== null && (
                  <div className="feed-angle">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" />
                    </svg>
                    <p>
                      <b>Angle:</b> {lead.replyAngle}
                    </p>
                  </div>
                )}
                <div className="feed-actions">
                  <a
                    className="btn btn-sm"
                    href={lead.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open thread
                    <IconExternal size={13} />
                  </a>
                  <RateLead itemId={lead.itemId} initial={lead.feedback} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function Stat({ label, value, lead = false }: { label: string; value: number; lead?: boolean }) {
  return (
    <div className={lead ? "stat stat-lead" : "stat"}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value.toLocaleString()}</p>
    </div>
  );
}

function FilterLink({
  label,
  href,
  on,
  kind,
}: {
  label: string;
  href: string;
  on: boolean;
  kind: string;
}) {
  return (
    <a className={on ? `filter ${kind} on` : `filter ${kind}`} href={href} aria-current={on ? "page" : undefined}>
      {label}
    </a>
  );
}
