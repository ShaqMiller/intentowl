/**
 * Signed feedback tokens (ARCHITECTURE.md section 4.5).
 *
 * A thumbs-up link in an email is a GET request from an unauthenticated inbox,
 * so the token *is* the authorisation. Two properties matter:
 *
 *   - **Unguessable.** Without a signature, `/f/<customerId>/<itemId>/up`
 *     would let anyone who can guess two UUIDs write into another customer's
 *     training data — which is the data that shapes what their classifier
 *     considers a good lead.
 *   - **Stateless.** No row is written when the digest is sent, so a digest
 *     from three weeks ago still works and there is no token table to expire.
 *
 * Deliberately *not* time-limited. People read digests late, and the cost of a
 * stale thumbs-up is nil next to the cost of silently dropping real feedback.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Hex characters of HMAC kept. 64 bits is far past guessable for this. */
const SIG_LENGTH = 16;
const ID_LENGTH = 32;

export type FeedbackVerdict = "up" | "down";

export interface FeedbackClaim {
  customerId: string;
  itemId: string;
}

/** UUID with dashes stripped, so the token stays short and URL-clean. */
function compact(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Put the dashes back: 8-4-4-4-12. */
function expand(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, SIG_LENGTH);
}

export function signFeedbackToken(
  secret: string,
  customerId: string,
  itemId: string,
): string {
  const payload = `${compact(customerId)}${compact(itemId)}`;
  return `${payload}${sign(secret, payload)}`;
}

/**
 * Verify a token and return what it claims, or null.
 *
 * Returns null for every failure mode rather than distinguishing them: a
 * caller that can tell "bad signature" from "malformed" apart gives an
 * attacker a search signal, and the route has nothing useful to do with the
 * difference anyway.
 */
export function verifyFeedbackToken(
  secret: string,
  token: string,
): FeedbackClaim | null {
  if (typeof token !== "string") return null;
  if (token.length !== ID_LENGTH * 2 + SIG_LENGTH) return null;
  if (!/^[0-9a-f]+$/.test(token)) return null;

  const payload = token.slice(0, ID_LENGTH * 2);
  const provided = token.slice(ID_LENGTH * 2);
  const expected = sign(secret, payload);

  // Constant-time compare. Lengths are equal by construction above, which
  // timingSafeEqual requires.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return {
    customerId: expand(payload.slice(0, ID_LENGTH)),
    itemId: expand(payload.slice(ID_LENGTH)),
  };
}

export function isFeedbackVerdict(value: unknown): value is FeedbackVerdict {
  return value === "up" || value === "down";
}
