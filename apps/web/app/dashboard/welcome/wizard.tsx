"use client";

/**
 * The setup wizard: describe → review → leads.
 *
 * Two forms, not one: the first costs a model call and the second commits a
 * search, and each gets its own pending state so neither is double-submitted.
 * The review step is the whole profile and search on one screen, because a
 * draft is only useful if every part of it can be corrected before it runs.
 */
import { useActionState } from "react";

import type { ActionResult } from "../../../src/actions.ts";
import { completeSetup, draftSetup, type DraftState } from "../../../src/onboarding-actions.ts";
import { IconAlert, IconCheck, IconPulse, IconTag, IconTarget } from "../icons.tsx";
import { LIVE_SOURCES } from "../searches/watch-fields.tsx";

/** Where a new search looks by default: the busiest sources with real asks. */
const DEFAULT_SOURCES = new Set(["hn", "bluesky", "lobsters"]);

export function SetupWizard({ drafting, preview }: { drafting: boolean; preview: boolean }) {
  const [draftState, draftAction, drafting_] = useActionState<DraftState, FormData>(draftSetup, {
    stage: "describe",
  });
  const [saveState, saveAction, saving] = useActionState<ActionResult | null, FormData>(completeSetup, null);

  const step = draftState.stage === "describe" ? 1 : 2;

  return (
    <div className="wizard">
      <ol className="wizard-steps" aria-label="Setup steps">
        <li className={step === 1 ? "on" : "done"}>
          <span>1</span> Describe what you sell
        </li>
        <li className={step === 2 ? "on" : ""}>
          <span>2</span> Review your search
        </li>
        <li>
          <span>3</span> Leads arrive
        </li>
      </ol>

      {draftState.stage === "describe" ? (
        <form action={draftAction} className="setcard">
          <div className="setcard-body">
            <div className="setcard-head">
              <IconTarget />
              <h3>What do you sell?</h3>
            </div>
            <p className="hint">
              A few sentences, the way you would explain it to another founder.
              {drafting
                ? " We draft your profile and search terms from this; you review every word before anything runs."
                : " You will fill in the details on the next screen."}
            </p>
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
          </div>
          <div className="setcard-foot">
            {draftState.message === undefined ? (
              <span>{drafting ? "Takes about 20 seconds." : "Nothing is saved yet."}</span>
            ) : (
              <p className="flash bad" role="status">
                {draftState.message}
              </p>
            )}
            <button className="btn btn-primary btn-sm" type="submit" disabled={drafting_}>
              {drafting_ ? "Drafting…" : drafting ? "Draft my setup" : "Continue"}
            </button>
          </div>
        </form>
      ) : (
        <form action={saveAction} className="wizard-review">
          {draftState.message !== undefined && (
            <div className="notice">
              <IconAlert size={13} /> {draftState.message}
            </div>
          )}
          {draftState.drafted && (
            <p className="wizard-note">
              <IconCheck size={13} /> Drafted from your description. Change anything that is not quite right — this is
              what every post will be judged against.
            </p>
          )}

          <div className="setcard">
            <div className="setcard-body">
              <div className="setcard-head">
                <IconTarget />
                <h3>Your profile</h3>
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
            </div>
          </div>

          <div className="setcard">
            <div className="setcard-body">
              <div className="setcard-head">
                <IconTag />
                <h3>Your first search</h3>
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
                  {LIVE_SOURCES.map((s) => (
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
            </div>
            <div className="setcard-foot">
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
              <button className="btn btn-primary btn-sm" type="submit" disabled={saving || preview}>
                {saving ? "Starting…" : "Start my search"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
