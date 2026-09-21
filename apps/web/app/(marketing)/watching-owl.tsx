"use client";

/**
 * The hero Otto, whose eyes follow the pointer.
 *
 * The server-rendered owl is untouched: this only sets two CSS variables on a
 * wrapper, and a stylesheet rule turns them into a translate on the pupils.
 * No re-render per mouse move, and before the script runs (or with it off) the
 * owl simply looks where it always did.
 *
 * Skipped for touch-only devices, where there is no pointer to watch, and for
 * anyone who has asked for reduced motion.
 */
import { useEffect, useRef } from "react";

import { Owl } from "../owl.tsx";

/** Eye centre and resting pupil offset, in the owl's 120x124 viewBox units. */
const EYE_Y = 56;
const REST = { x: 3, y: 2 };
/** How far a pupil may travel from the eye centre and still sit inside it. */
const REACH = 5.5;
/** Pointer distance, in CSS px, at which the pupils reach full travel. */
const FULL_AT = 320;

export function WatchingOwl({ size, className }: { size: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let px = 0;
    let py = 0;

    const apply = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + (box.height * EYE_Y) / 124;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy);
      // Where the pupil should sit relative to the eye centre, then expressed
      // as a shift from where the drawing already puts it.
      const reach = dist === 0 ? 0 : (REACH * Math.min(1, dist / FULL_AT)) / dist;
      el.style.setProperty("--px", (dx * reach - REST.x).toFixed(2));
      el.style.setProperty("--py", (dy * reach - REST.y).toFixed(2));
    };

    const onMove = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    // Pointer left the window: back to the resting gaze.
    const onLeave = () => {
      el.style.removeProperty("--px");
      el.style.removeProperty("--py");
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span ref={ref} className={className === undefined ? "owl-follow" : `owl-follow ${className}`}>
      <Owl mood="watching" size={size} />
    </span>
  );
}
