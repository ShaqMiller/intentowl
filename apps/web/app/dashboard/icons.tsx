/**
 * Inline icon set.
 *
 * Hand-drawn rather than pulled from a library: the project forbids new
 * runtime dependencies without asking, and a dozen 16-pixel glyphs is not
 * worth 300kB and a build step. They all take `currentColor`, so an icon
 * inherits whatever the text beside it is doing — active nav, muted hint,
 * accent focus — without a second colour system to keep in sync.
 *
 * One geometry for all of them: 16×16 box, 1.6 stroke, round caps. Mixing
 * stroke weights is the fastest way to make a set look borrowed.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Leads — an inbox with something in it. */
export function IconInbox(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M2 9.5h3l1 2h4l1-2h3" />
      <path d="M3.4 3h9.2l1.4 6.5v2.9a1.1 1.1 0 0 1-1.1 1.1H3.1A1.1 1.1 0 0 1 2 12.4V9.5Z" />
    </Base>
  );
}

/** Searches — a magnifier. */
export function IconSearch(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="m10.5 10.5 3 3" />
    </Base>
  );
}

/** What you sell — a target, because this is what everything is judged against. */
export function IconTarget(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <circle cx="8" cy="8" r="2.4" />
    </Base>
  );
}

/** Settings — sliders rather than a gear; these are values, not machinery. */
export function IconSliders(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M3 4.5h10M3 11.5h10" />
      <circle cx="6" cy="4.5" r="1.7" />
      <circle cx="10.5" cy="11.5" r="1.7" />
    </Base>
  );
}

export function IconGlobe(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M2.4 8h11.2" />
      <path d="M8 2.2a9 9 0 0 1 0 11.6a9 9 0 0 1 0-11.6Z" />
    </Base>
  );
}

/** Terms — a tag. */
export function IconTag(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M7.4 2.4H13a.6.6 0 0 1 .6.6v5.6L8 14.2 1.8 8 7.4 2.4Z" />
      <circle cx="10.6" cy="5.4" r="0.9" />
    </Base>
  );
}

/** Delivery — an envelope. */
export function IconMail(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.2" />
      <path d="m2.4 4.6 5.6 4 5.6-4" />
    </Base>
  );
}

export function IconLock(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="3.2" y="7" width="9.6" height="6.6" rx="1.3" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
    </Base>
  );
}

export function IconCard(p: IconProps) {
  return (
    <Base {...p}>
      <rect x="1.8" y="3.6" width="12.4" height="8.8" rx="1.4" />
      <path d="M1.8 6.8h12.4" />
    </Base>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.6" />
    </Base>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m3 8.4 3.2 3.1L13 4.6" />
    </Base>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </Base>
  );
}

export function IconExternal(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M9.4 2.6H13.4v4" />
      <path d="M13.4 2.6 7.6 8.4" />
      <path d="M12 9.6v3.2a.9.9 0 0 1-.9.9H3.2a.9.9 0 0 1-.9-.9V4.9a.9.9 0 0 1 .9-.9h3.2" />
    </Base>
  );
}

export function IconPause(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M6 3.4v9.2M10 3.4v9.2" />
    </Base>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M4.8 3.2 12.4 8l-7.6 4.8V3.2Z" />
    </Base>
  );
}

export function IconSignOut(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M6.4 13.4H3.6a.9.9 0 0 1-.9-.9V3.5a.9.9 0 0 1 .9-.9h2.8" />
      <path d="M10.2 11.2 13.4 8l-3.2-3.2" />
      <path d="M13.4 8H6.2" />
    </Base>
  );
}

/** Shown beside a source that is polling. */
export function IconPulse(p: IconProps) {
  return (
    <Base {...p}>
      <path d="M1.8 8h2.8l1.6-4 2.4 8 1.8-4h3.8" />
    </Base>
  );
}

export function IconAlert(p: IconProps) {
  return (
    <Base {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 5v3.4M8 10.8v.1" />
    </Base>
  );
}

/** Not for me — a cross, the pair to IconCheck. */
export function IconX(p: IconProps) {
  return (
    <Base {...p}>
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </Base>
  );
}
