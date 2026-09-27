"use client";

/**
 * "Check what these catch" — the answer, from real posts, before saving.
 *
 * Reads the words straight out of the surrounding form, so it always tests
 * what is on screen rather than what was last saved. On demand rather than on
 * every keystroke: a query per character would be noise, and the question is
 * one you ask when you have finished typing.
 */
import { useState, useTransition } from "react";

import { previewTerms, type TermPreview as Result } from "../../../src/preview-actions.ts";
import { IconPulse } from "../icons.tsx";

export function TermPreview() {
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  function run(button: HTMLButtonElement): void {
    const form = button.form;
    if (form === null) return;
    // FormData off the live form: the chips keep a hidden input in sync, so
    // this is exactly what a save would send.
    const data = new FormData(form);
    start(async () => {
      setResult(await previewTerms(data));
    });
  }

  return (
    <div className="term-preview">
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={(event) => run(event.currentTarget)}
      >
        <IconPulse size={13} />
        {pending ? "Checking…" : "Check what these catch"}
      </button>

      {result !== null && !pending && (
        <div className="term-preview-out" role="status">
          {result.scanned > 0 && (
            <p className="term-preview-count">
              Matches <b>{result.matched}</b> of the last {result.scanned.toLocaleString()} posts we
              read.
            </p>
          )}
          {result.message !== undefined && <p className="hint">{result.message}</p>}
          {result.examples.length > 0 && (
            <ul className="term-preview-list">
              {result.examples.map((example) => (
                <li key={example.title}>
                  <span className="term-preview-source">{example.source}</span>
                  {example.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
