/**
 * Otto the owl — IntentOwl's mascot, from the "Morning Paper" design system.
 *
 * Moods react to what the user did, never decorate for their own sake:
 *   watching — the default: logo, nav, onboarding
 *   happy    — found one: a good lead rated, setup finished
 *   sleepy   — a quiet day: empty states
 *
 * One Otto per screen at most: big on marketing pages, small in the dashboard.
 * The geometry is the design system's, verbatim; colours are literals because
 * the mascot is the same on every surface.
 */

export type OwlMood = "watching" | "happy" | "sleepy";

const INK = "#1C1A16";
const HONEY = "#F5B83D";
const EMBER = "#EB6B3A";
const BELLY = "#FFF3D6";

export interface OwlProps {
  mood?: OwlMood;
  /** Width in px; height follows the 120×124 viewBox. */
  size?: number;
  /** Body fill. White on a honey background, where honey would disappear. */
  body?: string;
  belly?: string;
  className?: string;
  /** Give a label only when the owl carries meaning; otherwise it is decorative. */
  title?: string;
}

export function Owl({
  mood = "watching",
  size = 120,
  body = HONEY,
  belly = BELLY,
  className,
  title,
}: OwlProps) {
  return (
    <svg
      width={size}
      height={Math.round((size * 124) / 120)}
      viewBox="0 0 120 124"
      className={className}
      {...(title === undefined ? { "aria-hidden": true } : { role: "img", "aria-label": title })}
    >
      <path
        d="M22 16 L44 30 Q60 25 76 30 L98 16 L101 56 L101 86 Q101 112 60 112 Q19 112 19 86 L19 56 Z"
        fill={body}
        stroke={INK}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <ellipse cx="60" cy="94" rx="22" ry="13" fill={belly} />
      {mood === "watching" && <Watching />}
      {mood === "happy" && <Happy />}
      {mood === "sleepy" && <Sleepy />}
      <path d="M48 112 L48 119 M72 112 L72 119" stroke={INK} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function Watching() {
  return (
    <>
      <path d="M27 70 Q34 86 30 100 M93 70 Q86 86 90 100" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <circle cx="43" cy="56" r="16" fill="#fff" stroke={INK} strokeWidth="4" />
      <circle cx="77" cy="56" r="16" fill="#fff" stroke={INK} strokeWidth="4" />
      <circle cx="46" cy="58" r="6.5" fill={INK} />
      <circle cx="80" cy="58" r="6.5" fill={INK} />
      <circle cx="48" cy="55.5" r="2" fill="#fff" />
      <circle cx="82" cy="55.5" r="2" fill="#fff" />
      <path d="M54 72 L66 72 L60 81 Z" fill={EMBER} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </>
  );
}

function Happy() {
  return (
    <>
      <path d="M19 66 Q4 56 8 38 M101 66 Q116 56 112 38" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <path d="M31 60 Q43 47 55 60 M65 60 Q77 47 89 60" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="33" cy="72" r="5" fill={EMBER} opacity="0.4" />
      <circle cx="87" cy="72" r="5" fill={EMBER} opacity="0.4" />
      <path d="M54 70 L66 70 L60 79 Z" fill={EMBER} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
    </>
  );
}

function Sleepy() {
  return (
    <>
      <path d="M27 70 Q34 86 30 100 M93 70 Q86 86 90 100" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <path d="M31 58 Q43 66 55 58 M65 58 Q77 66 89 58" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M54 72 L66 72 L60 81 Z" fill={EMBER} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <text x="100" y="26" fontFamily="Bricolage Grotesque, sans-serif" fontWeight="800" fontSize="18" fill={INK}>
        z
      </text>
    </>
  );
}

/**
 * The 34-38px logo mark: the watching mood redrawn with heavier strokes and
 * without the belly, wing lines and feet, which turn to mush at this size.
 */
export function OwlLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round((size * 124) / 120)} viewBox="0 0 120 124" aria-hidden="true">
      <path
        d="M22 16 L44 30 Q60 25 76 30 L98 16 L101 56 L101 86 Q101 112 60 112 Q19 112 19 86 L19 56 Z"
        fill={HONEY}
        stroke={INK}
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <circle cx="43" cy="56" r="16" fill="#fff" stroke={INK} strokeWidth="6" />
      <circle cx="77" cy="56" r="16" fill="#fff" stroke={INK} strokeWidth="6" />
      <circle cx="46" cy="58" r="7" fill={INK} />
      <circle cx="80" cy="58" r="7" fill={INK} />
      <path d="M54 74 L66 74 L60 83 Z" fill={EMBER} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}
