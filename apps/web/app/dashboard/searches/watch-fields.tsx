/**
 * The search editor's fields, shared by create and edit.
 *
 * Split across tabs and paired into two columns. Nine fields down one narrow
 * column read as a wall of inputs with no sense of what belonged with what;
 * grouped by question — where to look, what to match, how it runs — each pane
 * is a decision rather than a stretch of form.
 *
 * Every pane stays mounted (the Tabs component hides rather than unmounts), so
 * this is still one form with one save and nothing is lost by switching tab.
 *
 * Sources are split into what actually polls today and what does not. Offering
 * a customer a checkbox that silently returns nothing would be the dashboard
 * version of overstating the sources on the landing page. Reddit is the one
 * still on the wrong side of that line: the adapter exists and is tested
 * against fixtures, but has never completed a live poll.
 */
import {
  IconAlert,
  IconClock,
  IconGlobe,
  IconPulse,
  IconSearch,
  IconTag,
} from "../icons.tsx";
import { Tabs } from "../tabs.tsx";

export interface WatchDefaults {
  id?: string;
  name?: string;
  sources?: string[];
  includeTerms?: string[];
  excludeTerms?: string[];
  subreddits?: string[];
  feeds?: string[];
  active?: boolean;
}

export const LIVE_SOURCES: Array<{ key: string; label: string; note: string }> = [
  { key: "hn", label: "Hacker News", note: "Ask HN, Show HN, comments" },
  { key: "lobsters", label: "Lobsters", note: "small, developer-heavy" },
  {
    key: "stackexchange",
    label: "Stack Exchange",
    note: "problems described in detail",
  },
  { key: "rss", label: "RSS feeds", note: "any blog or forum with a feed" },
  { key: "bluesky", label: "Bluesky", note: "short posts, fast moving" },
  {
    key: "github",
    label: "GitHub issues",
    note: "people leaving a tool, in its own repo",
  },
];

const PENDING_SOURCES: Array<{ key: string; label: string; note: string }> = [
  { key: "reddit", label: "Reddit", note: "awaiting API approval" },
  { key: "threads", label: "Threads", note: "awaiting Meta approval" },
];

export function WatchFields({ defaults = {} }: { defaults?: WatchDefaults }) {
  const selected = new Set(defaults.sources ?? []);
  const active = defaults.active ?? true;

  const where = (
    <div className="grid2">
      <div>
        <fieldset className="field">
          <legend>Sources</legend>
          <div className="checks checks-tall">
            {LIVE_SOURCES.map((s) => (
              <label className="check" key={s.key}>
                <input
                  type="checkbox"
                  name="sources"
                  value={s.key}
                  defaultChecked={selected.has(s.key)}
                />
                <span>
                  <b>
                    <IconPulse size={13} />
                    {s.label}
                  </b>
                  <em>{s.note}</em>
                </span>
              </label>
            ))}
            {PENDING_SOURCES.map((s) => (
              <label className="check disabled" key={s.key}>
                <input type="checkbox" disabled />
                <span>
                  <b>
                    <IconAlert size={13} />
                    {s.label}
                  </b>
                  <em>{s.note}</em>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div>
        <div className="field">
          <label htmlFor="feeds">RSS feed URLs</label>
          <textarea
            id="feeds"
            name="feeds"
            rows={5}
            defaultValue={(defaults.feeds ?? []).join("\n")}
            placeholder={
              "https://example.com/blog/feed.xml\nhttps://forum.example.com/latest.rss"
            }
          />
          <p className="hint">
            One per line, http or https. Used when RSS is ticked. Entries are
            matched against your include terms like every other source.
          </p>
        </div>

        <div className="field">
          <label htmlFor="subreddits">Subreddits</label>
          <textarea
            id="subreddits"
            name="subreddits"
            rows={3}
            defaultValue={(defaults.subreddits ?? []).join("\n")}
            placeholder={"SaaS\nfreelance"}
          />
          <p className="hint">
            One per line, with or without the <code>r/</code>. Saved now so it
            is ready the day Reddit polling is approved.
          </p>
        </div>
      </div>
    </div>
  );

  const terms = (
    <div className="grid2">
      <div className="field">
        <label htmlFor="includeTerms">Include terms</label>
        <textarea
          id="includeTerms"
          name="includeTerms"
          rows={9}
          defaultValue={(defaults.includeTerms ?? []).join("\n")}
          placeholder={'"product analytics"\nmixpanel\nchasing late payments'}
        />
        <p className="hint">
          One per line. A post must match at least one of these before the
          classifier reads it, so these are a net rather than a judgement.
          <br />
          <br />
          <b>Quote a phrase</b> — <code>&quot;feature usage&quot;</code> — to
          require those words together. Unquoted, the words are matched
          separately and anywhere, which catches far more and is usually what
          you want for a brand name and rarely what you want for two common
          words.
        </p>
      </div>

      <div className="field">
        <label htmlFor="excludeTerms">Exclude terms</label>
        <textarea
          id="excludeTerms"
          name="excludeTerms"
          rows={9}
          defaultValue={(defaults.excludeTerms ?? []).join("\n")}
          placeholder={'"who is hiring"\nsalary\nupwork'}
        />
        <p className="hint">
          One per line. Anything matching these is dropped before it costs
          anything to classify, so this is the cheapest lever you have on the
          bill.
        </p>
      </div>
    </div>
  );

  const running = (
    <div className="grid2">
      <div className="field">
        <label htmlFor="name">Search name</label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={defaults.name ?? ""}
          placeholder="e.g. Invoicing complaints"
          maxLength={80}
          required
        />
        <p className="hint">
          Only you see this. It labels the leads this search finds, in the feed
          and in the digest.
        </p>
      </div>

      <div className="field">
        <label className="check standalone">
          <input type="checkbox" name="active" defaultChecked={active} />
          <span>
            <b>
              <IconClock size={13} />
              Active
            </b>
            <em>
              Paused searches keep every lead they have already found, and stop
              polling.
            </em>
          </span>
        </label>
      </div>
    </div>
  );

  return (
    <>
      {defaults.id !== undefined && (
        <input type="hidden" name="id" value={defaults.id} />
      )}
      <Tabs
        tabs={[
          { id: "where", label: "Where to look", icon: <IconGlobe />, content: where },
          { id: "terms", label: "Terms", icon: <IconTag />, content: terms },
          { id: "running", label: "Name and status", icon: <IconSearch />, content: running },
        ]}
      />
    </>
  );
}
