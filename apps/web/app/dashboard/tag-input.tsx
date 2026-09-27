"use client";

/**
 * The one control for every list in the dashboard.
 *
 * Before this, six fields asked for "one per line" in a textarea and then
 * explained the format in a paragraph: search terms, exclusions, subreddits,
 * feed URLs, competitors, disqualifiers. A textarea cannot show you what is
 * saved, cannot remove item six without editing text, and cannot express
 * "match this phrase exactly" without inventing quoting syntax nobody reads.
 *
 * Progressive enhancement, deliberately: the server renders a plain textarea
 * with the real field name, so the form works before hydration and without
 * JavaScript. On mount that textarea is replaced by chips plus a hidden input
 * carrying the same newline-joined value, so every server action is unchanged.
 */
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import { IconCheck, IconPlus, IconX } from "./icons.tsx";

export interface TagInputProps {
  name: string;
  label: string;
  /** One line, under the label. Says what the person gets, not how it works. */
  hint?: string;
  defaultValue?: readonly string[];
  placeholder?: string;
  /** Click to add. The three or four everyone ends up wanting. */
  suggestions?: readonly string[];
  /** Offers each chip an "exact phrase" toggle, which replaces quote syntax. */
  phrases?: boolean;
  /** Marks a chip that is not a valid http(s) URL. */
  urls?: boolean;
  /** Strips a leading r/ so subreddits are stored one way. */
  subreddits?: boolean;
  /** Shown beside the count when the list is longer than the poll searches. */
  softLimit?: number;
}

const SPLIT = /[\n,]/;

export function TagInput({
  name,
  label,
  hint,
  defaultValue = [],
  placeholder,
  suggestions = [],
  phrases = false,
  urls = false,
  subreddits = false,
  softLimit,
}: TagInputProps) {
  const [tags, setTags] = useState<string[]>(() => [...defaultValue]);
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);
  const inputId = useId();
  const box = useRef<HTMLDivElement>(null);

  // Swap to chips only once mounted: the server-rendered textarea carries the
  // real field name, so the form is submittable before hydration and with no
  // JavaScript at all.
  useEffect(() => setReady(true), []);

  if (!ready) {
    return (
      <div className="field">
        <label htmlFor={inputId}>{label}</label>
        <textarea
          id={inputId}
          name={name}
          rows={4}
          defaultValue={tags.join("\n")}
          placeholder={placeholder}
        />
        {hint !== undefined && <p className="hint">{hint}</p>}
      </div>
    );
  }

  function clean(value: string): string {
    const trimmed = value.trim();
    if (subreddits) return trimmed.replace(/^\/?r\//i, "");
    return trimmed;
  }

  function add(values: readonly string[]): void {
    setTags((current) => {
      const next = [...current];
      for (const value of values) {
        const tag = clean(value);
        if (tag === "") continue;
        if (next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
        next.push(tag);
      }
      return next;
    });
  }

  function commitDraft(): void {
    if (draft.trim() === "") return;
    add(draft.split(SPLIT));
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
      if (draft.trim() === "") return;
      // Enter inside a form would submit it; a half-typed term is not a save.
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      event.preventDefault();
      // Put it back in the box rather than vanishing it, so a slip is a fix.
      setDraft(tags[tags.length - 1] ?? "");
      setTags((current) => current.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>): void {
    const text = event.clipboardData.getData("text");
    if (!SPLIT.test(text)) return;
    event.preventDefault();
    add(text.split(SPLIT));
  }

  function remove(index: number): void {
    setTags((current) => current.filter((_, i) => i !== index));
  }

  function togglePhrase(index: number): void {
    setTags((current) =>
      current.map((tag, i) => {
        if (i !== index) return tag;
        return isPhrase(tag) ? tag.slice(1, -1) : `"${tag}"`;
      }),
    );
  }

  const unused = suggestions.filter(
    (suggestion) => !tags.some((tag) => tag.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div className="field tag-field">
      <label htmlFor={inputId}>
        {label}
        {tags.length > 0 && (
          <span className="tag-count">
            {tags.length}
            {softLimit !== undefined && tags.length > softLimit ? ` · ${softLimit} searched` : ""}
          </span>
        )}
      </label>

      <div
        ref={box}
        className="tag-box"
        onClick={(event) => {
          if (event.target === box.current) box.current?.querySelector("input")?.focus();
        }}
      >
        {tags.map((tag, index) => (
          <span
            className={urls && !isUrl(tag) ? "tag tag-bad" : "tag"}
            key={`${tag}-${String(index)}`}
          >
            {phrases && (
              <button
                type="button"
                className={isPhrase(tag) ? "tag-phrase on" : "tag-phrase"}
                onClick={() => togglePhrase(index)}
                aria-pressed={isPhrase(tag)}
                title={
                  isPhrase(tag)
                    ? "Matching these words together, in this order"
                    : "Match these words together, in this order"
                }
              >
                <IconCheck size={11} />
              </button>
            )}
            <span className="tag-text">{display(tag)}</span>
            <button
              type="button"
              className="tag-x"
              onClick={() => remove(index)}
              aria-label={`Remove ${display(tag)}`}
            >
              <IconX size={11} />
            </button>
          </span>
        ))}

        <input
          id={inputId}
          className="tag-draft"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commitDraft}
          placeholder={tags.length === 0 ? placeholder : "Add another…"}
          aria-describedby={`${inputId}-hint`}
        />
      </div>

      <input type="hidden" name={name} value={tags.join("\n")} />

      {unused.length > 0 && (
        <p className="tag-suggests">
          {unused.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              className="tag-suggest"
              onClick={() => add([suggestion])}
            >
              <IconPlus size={11} />
              {display(suggestion)}
            </button>
          ))}
        </p>
      )}

      {hint !== undefined && (
        <p className="hint" id={`${inputId}-hint`}>
          {hint}
          {phrases && " Tick a term to match those words together, in that order."}
        </p>
      )}
    </div>
  );
}

/** Quoted terms are matched as an exact phrase by the pre-filter. */
function isPhrase(tag: string): boolean {
  return tag.length > 1 && tag.startsWith('"') && tag.endsWith('"');
}

/** The quotes are the storage format, not something to read on a chip. */
function display(tag: string): string {
  return isPhrase(tag) ? tag.slice(1, -1) : tag;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
