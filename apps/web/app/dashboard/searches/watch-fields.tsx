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
import { SourceOverlap, TermOverlap, type OtherSearch } from "./overlap.tsx";
import { TagInput } from "../tag-input.tsx";
import { TermPreview } from "./term-preview.tsx";

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

/** Every source key we might have to name, including ones not yet polling. */
export const SOURCE_LABELS: Record<string, string> = {
  hn: "Hacker News",
  lobsters: "Lobsters",
  stackexchange: "Stack Exchange",
  rss: "RSS feeds",
  bluesky: "Bluesky",
  github: "GitHub issues",
  reddit: "Reddit",
  threads: "Threads",
  x: "X",
};

const PENDING_SOURCES: Array<{ key: string; label: string; note: string }> = [
  { key: "reddit", label: "Reddit", note: "coming soon — we will switch it on for you" },
  { key: "threads", label: "Threads", note: "coming soon — we will switch it on for you" },
];

export function WatchFields({
  defaults = {},
  others = [],
}: {
  defaults?: WatchDefaults;
  /** The customer's other searches, so this one can say what they cover. */
  others?: OtherSearch[];
}) {
  const selected = new Set(defaults.sources ?? []);
  const active = defaults.active ?? true;

  const where = (
    <div className="grid2">
      <div>
        <fieldset className="field">
          <legend>Where should we read?</legend>
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

        <SourceOverlap others={others} labels={SOURCE_LABELS} />
      </div>

      <div>
        <TagInput
          name="feeds"
          label="Blog or forum feeds"
          defaultValue={defaults.feeds ?? []}
          placeholder="https://example.com/blog/feed.xml"
          urls
          hint="Only read when RSS feeds is ticked above."
        />

        <TagInput
          name="subreddits"
          label="Subreddits to watch"
          defaultValue={defaults.subreddits ?? []}
          placeholder="SaaS"
          subreddits
          suggestions={["SaaS", "startups", "smallbusiness"]}
          hint="Saved now, ready for the day Reddit approves us."
        />
      </div>
    </div>
  );

  const terms = (
    <>
      <div className="grid2">
        <TagInput
          name="includeTerms"
          label="Words to look for"
          defaultValue={defaults.includeTerms ?? []}
          placeholder="chasing late payments"
          phrases
          softLimit={10}
          hint="We only read a post if it contains one of these."
        />

        <TagInput
          name="excludeTerms"
          label="Words to skip"
          defaultValue={defaults.excludeTerms ?? []}
          placeholder="salary"
          suggestions={['"who is hiring"', "upwork", "fiverr"]}
          hint="A post with any of these never reaches you."
        />
      </div>

      <TermOverlap others={others} />

      {/* The answer to "will this find anything?", measured on posts we have
          already read rather than guessed at. */}
      <TermPreview />
    </>
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
          Only you see it. It labels these leads in your feed and digest.
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
            <em>Pause any time. You keep every lead already found.</em>
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
          { id: "running", label: "Name", icon: <IconSearch />, content: running },
          { id: "terms", label: "Words", icon: <IconTag />, content: terms },
          { id: "where", label: "Where to look", icon: <IconGlobe />, content: where },
        ]}
      />
    </>
  );
}
