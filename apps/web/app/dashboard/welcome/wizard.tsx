"use client";

/**
 * The setup wizard: describe → review → leads.
 *
 * Two forms, not one: the first costs a model call and the second commits a
 * search, and each gets its own pending state so neither is double-submitted.
 * The review step is the whole profile and search on one screen, because a
 * draft is only useful if every part of it can be corrected before it runs.
 */
import { useActionState, type ReactNode } from "react";

import type { ActionResult } from "../../../src/actions.ts";
import { completeSetup, draftSetup, type DraftState } from "../../../src/onboarding-actions.ts";
import { Owl } from "../../owl.tsx";
import { IconAlert, IconPulse, IconTag, IconTarget } from "../icons.tsx";
import { LIVE_SOURCES } from "../searches/watch-fields.tsx";

/** Where a new search looks by default: the busiest sources with real asks. */
const DEFAULT_SOURCES = new Set(["hn", "bluesky", "lobsters"]);

/**
 * RSS is left out of setup: it needs feed URLs, which this screen does not
 * ask for, and ticking it without any would be refused. It can be switched on
 * later in the search editor, where the feed field lives.
 */
const SETUP_SOURCES = LIVE_SOURCES.filter((s) => s.key !== "rss");

export function SetupWizard({
  drafting,
  preview,
  intro,
}: {
  drafting: boolean;
  preview: boolean;
  /** The page heading and lede, rendered by the server page. */
  intro: ReactNode;
}) {
  const [draftState, draftAction, drafting_] = useActionState<DraftState, FormData>(draftSetup, {
    stage: "describe",
  });
  const [saveState, saveAction, saving] = useActionState<ActionResult | null, FormData>(completeSetup, null);

  const step = draftState.stage === "describe" ? 1 : 2;

  // What Otto says. Step 1 carries what used to be the card's hint; step 2 the
  // "drafted from your description" note.
  const bubble =
    step === 1
      ? `A few sentences, the way you would explain it to another founder.${
          drafting
            ? " We draft your profile and search terms from this; you review every word before anything runs."
            : " You will fill in the details on the next screen."
        }`
      : `${draftState.stage === "review" && draftState.drafted ? "Drafted from your description. " : ""}Change anything that is not quite right — this is what every post will be judged against.`;

  return (
    <div className="wizard">
      <header className="wizard-top">
        <span className="wizard-top-label">
          Step {step} of 3
        </span>
        <div
          className="wizard-progress"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={3}
          aria-valuenow={step}
        >
          <span style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      </header>

      <div className="wizard-body">
        <div className="wizard-intro">{intro}</div>

        <ol className="wizard-steps" aria-label="Setup steps">
          <li className={step === 1 ? "on" : "done"} aria-current={step === 1 ? "step" : undefined}>
            <span>1</span> Describe what you sell
          </li>
          <li className="wizard-sep" aria-hidden="true" />
          <li className={step === 2 ? "on" : ""} aria-current={step === 2 ? "step" : undefined}>
            <span>2</span> Review your search
          </li>
          <li className="wizard-sep" aria-hidden="true" />
          <li>
            <span>3</span> Leads arrive
          </li>
        </ol>

        <div className="wizard-main">
          <div className="wizard-otto">
            <Owl mood="watching" size={84} />
            <p className="wizard-bubble">{bubble}</p>
          </div>

      {draftState.stage === "describe" ? (
        <form action={draftAction} className="wizard-card">
          <section className="wizard-section">
            <div className="setcard-head">
              <IconTarget />
              <h2>What do you sell?</h2>
            </div>
            <div className="field">
              <label htmlFor="description">Your product</label>
              <textarea
                id="description"
                name="description"
                rows={6}
                required
                placeholder="e.g. An invoicing tool for freelancers that chases late payments automatically, so they stop sending awkward reminder emails themselves."
              />
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="audience">Who buys it (optional)</label>
                <textarea id="audience" name="audience" rows={3} placeholder="Solo freelancers and small agencies" />
              </div>
              <div className="field">
                <label htmlFor="competitors">Competitors (optional)</label>
                <textarea id="competitors" name="competitors" rows={3} placeholder="FreshBooks, Wave" />
              </div>
            </div>
          </section>
          <div className="wizard-foot">
            {draftState.message === undefined ? (
              <span>{drafting ? "Takes about 20 seconds." : "Nothing is saved yet."}</span>
            ) : (
              <p className="flash bad" role="status">
                {draftState.message}
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={drafting_}>
              {drafting_ ? "Drafting…" : drafting ? "Draft my setup" : "Continue"}
              <Arrow />
            </button>
          </div>
        </form>
      ) : (
        <form action={saveAction} className="wizard-review">
          {draftState.message !== undefined && (
            <div className="notice wizard-notice">
              <IconAlert size={14} /> {draftState.message}
            </div>
          )}

          <div className="wizard-card">
            <section className="wizard-section">
              <div className="setcard-head">
                <IconTarget />
                <h2>Your profile</h2>
              </div>
              <div className="field">
                <label htmlFor="productDesc">What the product does</label>
                <textarea id="productDesc" name="productDesc" rows={4} required defaultValue={draftState.draft.productDesc} />
                <p className="hint">Include what people do instead of using you — that is the situation a lead describes.</p>
              </div>
              <div className="field">
                <label htmlFor="icpDesc">Who it is for</label>
                <textarea id="icpDesc" name="icpDesc" rows={3} required defaultValue={draftState.draft.icpDesc} />
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="competitors-review">Competitors</label>
                  <textarea id="competitors-review" name="competitors" rows={5} defaultValue={draftState.draft.competitors.join("\n")} />
                  <p className="hint">One per line. A complaint about one of these is the strongest signal there is.</p>
                </div>
                <div className="field">
                  <label htmlFor="disqualifiers">Definitely not a customer</label>
                  <textarea id="disqualifiers" name="disqualifiers" rows={5} defaultValue={draftState.draft.disqualifiers.join("\n")} />
                  <p className="hint">One per line. Keeps plausible-but-useless posts out of your inbox.</p>
                </div>
              </div>
            </section>

            <section className="wizard-section">
              <div className="setcard-head">
                <IconTag />
                <h2>Your first search</h2>
              </div>
              <div className="field">
                <label htmlFor="name">Search name</label>
                <input id="name" name="name" type="text" required maxLength={80} defaultValue={draftState.draft.searchName} />
              </div>
              <div className="grid2">
                <div className="field">
                  <label htmlFor="includeTerms">Include terms</label>
                  <textarea id="includeTerms" name="includeTerms" rows={10} required defaultValue={draftState.draft.includeTerms.join("\n")} />
                  <p className="hint">
                    One per line, as someone with the problem would write it. Quote a phrase to match it exactly.
                  </p>
                </div>
                <div className="field">
                  <label htmlFor="excludeTerms">Exclude terms</label>
                  <textarea id="excludeTerms" name="excludeTerms" rows={10} defaultValue={draftState.draft.excludeTerms.join("\n")} />
                  <p className="hint">One per line. Posts matching these are dropped before they cost anything.</p>
                </div>
              </div>
              <fieldset className="field">
                <legend>Where to look</legend>
                <div className="checks">
                  {SETUP_SOURCES.map((s) => (
                    <label className="check" key={s.key}>
                      <input type="checkbox" name="sources" value={s.key} defaultChecked={DEFAULT_SOURCES.has(s.key)} />
                      <span>
                        <b>
                          <IconPulse size={13} />
                          {s.label}
                        </b>
                        <em>{s.note}</em>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <input type="hidden" name="active" value="on" />
              <input type="hidden" name="subreddits" value="" />
              <input type="hidden" name="feeds" value="" />
            </section>
            <div className="wizard-foot">
              {saveState !== null && !saveState.ok ? (
                <p className="flash bad" role="status">
                  {saveState.message}
                </p>
              ) : (
                <span>
                  {preview
                    ? "Preview only — saving is disabled because this account is already set up."
                    : "Polling starts within minutes and looks back a week."}
                </span>
              )}
              <button className="btn btn-primary" type="submit" disabled={saving || preview}>
                {saving ? "Starting…" : "Start my search"}
                <Arrow />
              </button>
            </div>
          </div>
        </form>
      )}
        </div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
