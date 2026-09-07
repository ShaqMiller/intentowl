"use client";

/**
 * The rotating source name in the hero.
 *
 * Characters decode into place rather than the word simply swapping: each
 * position cycles through random glyphs for a few frames before settling on
 * its final letter, left to right. It reads as the product doing something —
 * scanning — rather than as decoration, which is the only reason it earns its
 * place on a page whose job is to sell.
 *
 * The words are the sources IntentOwl actually reads today. Reddit is not in
 * the list on purpose: the adapter exists but has never run against the live
 * API, and a landing page is a promise.
 */
import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&/\\<>*+=";

export interface ScrambleWordProps {
  words: string[];
  /** How long each word rests before the next decode starts. */
  holdMs?: number;
}

export function ScrambleWord({ words, holdMs = 2400 }: ScrambleWordProps) {
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  const [display, setDisplay] = useState(words[0] ?? "");
  const frame = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (words.length < 2) return;

    // Respect the setting rather than overriding it: a decode effect is
    // exactly the kind of motion people turn this on to avoid.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      let i = 0;
      const swap = setInterval(() => {
        i = (i + 1) % words.length;
        setDisplay(words[i] ?? "");
      }, holdMs + 600);
      return () => clearInterval(swap);
    }

    let index = 0;
    let timer: ReturnType<typeof setTimeout>;

    const decodeTo = (next: string) => {
      const from = words[index] ?? "";
      const length = Math.max(from.length, next.length);
      // Each character settles a little after the one before it, so the word
      // resolves left to right instead of all at once.
      const settleAt = Array.from({ length }, (_, i) => 6 + i * 2.2);
      frame.current = 0;

      const tick = () => {
        let out = "";
        let done = 0;
        for (let i = 0; i < length; i += 1) {
          const target = next[i] ?? "";
          if (frame.current >= (settleAt[i] ?? 0)) {
            out += target;
            done += 1;
          } else if (target === " ") {
            out += " ";
            done += 1;
          } else {
            out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
        }
        setDisplay(out);
        frame.current += 1;

        if (done < length) {
          raf.current = requestAnimationFrame(tick);
        } else {
          timer = setTimeout(() => {
            index = (index + 1) % words.length;
            decodeTo(words[(index + 1) % words.length] ?? "");
          }, holdMs);
        }
      };
      tick();
    };

    timer = setTimeout(() => decodeTo(words[1] ?? ""), holdMs);

    return () => {
      clearTimeout(timer);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [words, holdMs]);

  return (
    <span className="scramble">
      {/* Reserves the width of the longest word so the headline never reflows
          mid-animation, which would make the whole line jitter. */}
      <span className="scramble-ghost" aria-hidden="true">
        {longest}
      </span>
      <span className="scramble-live" aria-live="polite">
        {display}
      </span>
    </span>
  );
}
