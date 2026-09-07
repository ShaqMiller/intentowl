/**
 * Pre-filter — the cost firewall (ARCHITECTURE.md section 4.2).
 *
 * A dumb-fast rules pass that drops most fetched items before anything touches
 * an LLM. Pure functions only: no I/O, no clock, no randomness, so the whole
 * thing is unit-testable and cheap to reason about.
 *
 * The asymmetry that governs every rule here: a Haiku classification costs
 * about $0.001, and a missed lead costs trust. So when a rule is uncertain, it
 * lets the item through. Every false *negative* at this stage is an invisible
 * lost lead — nothing downstream can recover it, and nobody will ever know.
 *
 * That doctrine was violated by the first implementation. `containsTerm` did
 * contiguous-phrase matching, so `find first customers` failed to match "find
 * *your* first customers" and recall against the golden set measured 29%.
 * Matching is now token-based, which is what §4.2's "stemmed-ish via lowercase
 * + word boundaries" actually describes. `recall.test.ts` holds the line.
 */

export interface FilterInput {
  title: string | null;
  body: string | null;
  venue: string | null;
  author: string | null;
}

export interface FilterConfig {
  includeTerms: readonly string[];
  excludeTerms: readonly string[];
  /** Combined title+body characters below this are almost never a lead. */
  minLength?: number;
  /**
   * Per-venue multipliers. A venue weighted above 1 is trusted enough to skip
   * the keyword requirement entirely; one at 0 is muted (ARCHITECTURE §4.2).
   */
  venueWeights?: Readonly<Record<string, number>>;
}

export type FilterReason =
  | "no_text"
  | "too_short"
  | "excluded_term"
  | "structural_noise"
  | "no_include_match"
  | "muted_venue"
  | "not_latin_script"
  | "deleted_author";

export interface FilterVerdict {
  keep: boolean;
  /** Why it was dropped. Null when kept. */
  reason: FilterReason | null;
  /** Which include terms matched — carried into the prompt as a hint. */
  matched: string[];
  /** Which exclude term killed it, for debugging a customer's watch. */
  excludedBy: string | null;
}

const DEFAULT_MIN_LENGTH = 24;

/**
 * Function words only — articles, prepositions, possessives, auxiliaries.
 * Dropped from *terms* so an interpolated word cannot break a match; the
 * haystack keeps every word it had.
 *
 * Deliberately small. A wider list is tempting but backfires: with "get" and
 * "more" included, the term "more users" collapsed to the single token "user"
 * and started matching a post about Kubernetes DevOps jobs. Stopword removal
 * must make a term more *flexible*, never more *general*.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "at", "by", "for", "with", "about",
  "into", "to", "from", "in", "on", "is", "are", "was", "were", "be", "been",
  "being", "as", "that", "this", "it", "its", "i", "me", "my", "we", "our",
  "you", "your", "their", "do", "does", "did",
]);

/**
 * Patterns that are structurally not leads regardless of the customer.
 * Deliberately narrow: each one is a format, not a topic.
 *
 * Unanchored, because real titles carry prefixes — HN's biggest noise thread is
 * literally "Ask HN: Who is hiring? (September 2026)", which an `^`-anchored
 * pattern misses entirely. Matched against the title only.
 */
const STRUCTURAL_NOISE = [
  /\[hiring]/i,
  /\[for hire]/i,
  /\bhiring:/i,
  /\bwho(?:'|’)?s hiring\b/i,
  /\bwho is hiring\b/i,
  /\bwho wants to be hired\b/i,
  /\bseeking freelancer\b/i,
  /\bfreelancer\?/i,
  /\b(?:weekly|monthly|daily)\s+(?:thread|discussion|megathread|ask)/i,
  /\bmegathread\b/i,
  /\bwho is hiring\b/i,
  /^\s*\[?meta]/i,
] as const;

/**
 * Decide whether one item is worth spending a classification on.
 *
 * `includeTerms` are OR-matched: any one is enough. An empty include list means
 * "no keyword requirement", which lets a watch rely purely on venue.
 */
export function applyFilter(
  item: FilterInput,
  config: FilterConfig,
): FilterVerdict {
  const title = item.title ?? "";
  const body = item.body ?? "";
  const raw = `${title}\n${body}`;

  if (raw.trim() === "") return verdict(false, "no_text");

  const haystack = normalise(raw);

  // Normalising a non-Latin post yields an empty string. That is a *language*
  // outcome, not an absence of text, and reporting it honestly keeps the
  // drop-reason histogram readable. §4.2 asks for a language check; this is it.
  if (haystack === "") return verdict(false, "not_latin_script");

  const weight = venueWeight(item.venue, config.venueWeights);
  if (weight === 0) return verdict(false, "muted_venue");

  // A deleted author means nobody to reply to. The Reddit adapter already maps
  // "[deleted]" to null, so in practice only the null arm fires — the literal
  // is kept because a future adapter (RSS, Bluesky) may not normalise it.
  if (item.author === null || item.author === "[deleted]") {
    return verdict(false, "deleted_author");
  }

  const minLength = config.minLength ?? DEFAULT_MIN_LENGTH;
  // Measured on title+body: a bare "Anyone know a tool for X?" title is a
  // perfectly good lead even with an empty body.
  if (`${title} ${body}`.trim().length < minLength) {
    return verdict(false, "too_short");
  }

  for (const pattern of STRUCTURAL_NOISE) {
    if (pattern.test(title)) return verdict(false, "structural_noise");
  }

  const haystackTokens = new Set(tokenise(haystack));

  // Exclusions beat inclusions: "[hiring] react dev, must know lead
  // generation" matches an include term but is still a job post.
  for (const term of config.excludeTerms) {
    if (termMatches(haystack, haystackTokens, term)) {
      return {
        keep: false,
        reason: "excluded_term",
        // Kept, unlike the first implementation, so a debug log can show
        // "excluded by X despite matching Y" — the thing you need to debug
        // a customer's watch.
        matched: matchingTerms(haystack, haystackTokens, config.includeTerms),
        excludedBy: term,
      };
    }
  }

  if (config.includeTerms.length === 0) return verdict(true, null);

  const matched = matchingTerms(haystack, haystackTokens, config.includeTerms);
  if (matched.length > 0) {
    return { keep: true, reason: null, matched, excludedBy: null };
  }

  // A venue the customer trusts above baseline gets in without a keyword hit.
  // This is the §4.2 escape hatch for exactly the recall problem token
  // matching is otherwise carrying alone.
  if (weight > 1) return verdict(true, null);

  return verdict(false, "no_include_match");
}

// --- matching ---------------------------------------------------------------

/**
 * Does `term` match the text?
 *
 * A term wrapped in double quotes is matched as an exact contiguous phrase.
 * Everything else is matched as a bag of stemmed content words: all of them
 * must appear, in any order, anywhere in the text. That is what lets
 * `marketing as a solo founder` match "marketing as a solo *technical*
 * founder", and `find first customers` match "find *your* first customer".
 */
export function termMatches(
  normalisedHaystack: string,
  haystackTokens: ReadonlySet<string>,
  term: string,
): boolean {
  const trimmed = term.trim();

  if (trimmed.length > 1 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const phrase = normalise(trimmed.slice(1, -1));
    if (phrase === "") return false;
    return ` ${normalisedHaystack} `.includes(` ${phrase} `);
  }

  const needles = termTokens(trimmed);
  if (needles.length === 0) return false;
  return needles.every((needle) => haystackTokens.has(needle));
}

function matchingTerms(
  haystack: string,
  haystackTokens: ReadonlySet<string>,
  terms: readonly string[],
): string[] {
  return terms.filter((term) => termMatches(haystack, haystackTokens, term));
}

/** Content tokens of a term: stopwords removed, everything stemmed. */
export function termTokens(term: string): string[] {
  const all = tokenise(normalise(term));
  const content = all.filter((token) => !STOPWORDS.has(token));
  // A term made entirely of stopwords ("how do you") would otherwise match
  // everything; fall back to the literal tokens so it matches only itself.
  return (content.length > 0 ? content : all).map(stem);
}

function tokenise(normalised: string): string[] {
  return normalised === "" ? [] : normalised.split(" ").map(stem);
}

/**
 * Crude English suffix stripping — "stemmed-ish", per §4.2. Not a real stemmer
 * and deliberately not: the goal is `customers` ≈ `customer`, not linguistic
 * correctness. Short words are left alone so `as`, `is` and `its` survive.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ss|sh|ch|x|z)es$/.test(word)) return word.slice(0, -2);
  if (!word.endsWith("s")) return word;
  if (word.endsWith("ss")) return word;
  // A trailing "s" after a vowel is usually part of the word, not a plural:
  // saas, gas, bus, analysis, apis. After a consonant or an "e" it usually is
  // a plural: customers, users, types. Crude, and right far more often than
  // stripping unconditionally — which turned "saas" into "saa".
  return /[aiou]s$/.test(word) ? word : word.slice(0, -1);
}

/**
 * Fold to lowercase ASCII words separated by single spaces.
 *
 * NFKD first, so accented letters decompose and the combining marks strip
 * cleanly — `naïve` becomes `naive` rather than being shredded into `na ve`.
 * `+` and `#` survive so `c++` and `c#` stay distinguishable.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function venueWeight(
  venue: string | null,
  weights: Readonly<Record<string, number>> | undefined,
): number {
  if (venue === null || weights === undefined) return 1;
  return weights[venue] ?? weights[venue.toLowerCase()] ?? 1;
}

function verdict(keep: boolean, reason: FilterReason | null): FilterVerdict {
  return { keep, reason, matched: [], excludedBy: null };
}

/** Roll a batch of verdicts up into counts, for the classify logs. */
export function summarise(verdicts: readonly FilterVerdict[]): {
  kept: number;
  dropped: number;
  byReason: Record<string, number>;
  /** Which include terms actually fired — surfaces terms that never match. */
  byTerm: Record<string, number>;
} {
  const byReason: Record<string, number> = {};
  const byTerm: Record<string, number> = {};
  let kept = 0;
  for (const v of verdicts) {
    for (const term of v.matched) byTerm[term] = (byTerm[term] ?? 0) + 1;
    if (v.keep) {
      kept += 1;
      continue;
    }
    const key = v.reason ?? "unknown";
    byReason[key] = (byReason[key] ?? 0) + 1;
  }
  return { kept, dropped: verdicts.length - kept, byReason, byTerm };
}
