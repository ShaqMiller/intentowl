/**
 * The search editor's fields, shared by create and edit.
 *
 * Sources are split into what actually polls today and what does not. Offering
 * a customer a checkbox for Reddit that silently returns nothing would be the
 * dashboard version of listing it on the landing page — the adapter exists, but
 * it has never run against the live API.
 */
export interface WatchDefaults {
  id?: string;
  name?: string;
  sources?: string[];
  includeTerms?: string[];
  excludeTerms?: string[];
  subreddits?: string[];
  active?: boolean;
}

const LIVE_SOURCES: Array<{ key: string; label: string; note: string }> = [
  { key: "hn", label: "Hacker News", note: "Ask HN, Show HN, comments" },
  { key: "lobsters", label: "Lobsters", note: "small, developer-heavy" },
  {
    key: "stackexchange",
    label: "Stack Exchange",
    note: "problems described in detail",
  },
];

const PENDING_SOURCES: Array<{ key: string; label: string; note: string }> = [
  { key: "reddit", label: "Reddit", note: "awaiting API approval" },
  { key: "bluesky", label: "Bluesky", note: "not built yet" },
  { key: "rss", label: "RSS", note: "not built yet" },
];

export function WatchFields({ defaults = {} }: { defaults?: WatchDefaults }) {
  const selected = new Set(defaults.sources ?? []);
  const active = defaults.active ?? true;

  return (
    <>
      {defaults.id !== undefined && (
        <input type="hidden" name="id" value={defaults.id} />
      )}

      <div className="field">
        <label htmlFor="name">Name</label>
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
          Only you see this. It labels the leads this search finds.
        </p>
      </div>

      <fieldset className="field">
        <legend>Where to look</legend>
        <div className="checks">
          {LIVE_SOURCES.map((s) => (
            <label className="check" key={s.key}>
              <input
                type="checkbox"
                name="sources"
                value={s.key}
                defaultChecked={selected.has(s.key)}
              />
              <span>
                <b>{s.label}</b>
                <em>{s.note}</em>
              </span>
            </label>
          ))}
        </div>
        <div className="checks">
          {PENDING_SOURCES.map((s) => (
            <label className="check disabled" key={s.key}>
              <input type="checkbox" disabled />
              <span>
                <b>{s.label}</b>
                <em>{s.note}</em>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="includeTerms">Include terms</label>
        <textarea
          id="includeTerms"
          name="includeTerms"
          rows={6}
          defaultValue={(defaults.includeTerms ?? []).join("\n")}
          placeholder={"find first customers\ninvoicing tool\nchasing late payments"}
        />
        <p className="hint">
          One per line. A post has to match at least one of these to be read by
          the classifier at all, so keep them broad — these are a net, not a
          judgement. Words are matched individually and stemmed, so{" "}
          <code>find first customers</code> also catches &ldquo;how did you find
          your first customer&rdquo;.
        </p>
      </div>

      <div className="field">
        <label htmlFor="excludeTerms">Exclude terms</label>
        <textarea
          id="excludeTerms"
          name="excludeTerms"
          rows={3}
          defaultValue={(defaults.excludeTerms ?? []).join("\n")}
          placeholder={"hiring\nsalary\nwho is hiring"}
        />
        <p className="hint">
          One per line. Anything matching these is dropped before it costs
          anything to classify.
        </p>
      </div>

      <div className="field">
        <label htmlFor="subreddits">Subreddits</label>
        <textarea
          id="subreddits"
          name="subreddits"
          rows={2}
          defaultValue={(defaults.subreddits ?? []).join("\n")}
          placeholder={"SaaS\nfreelance"}
        />
        <p className="hint">
          One per line, with or without the <code>r/</code>. Only used once
          Reddit polling is approved — saved now so it is ready.
        </p>
      </div>

      <div className="field">
        <label className="check standalone">
          <input type="checkbox" name="active" defaultChecked={active} />
          <span>
            <b>Active</b>
            <em>Paused searches keep their history but stop polling.</em>
          </span>
        </label>
      </div>
    </>
  );
}
