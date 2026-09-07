/**
 * The one place adapters touch the network.
 *
 * Its job is to turn every failure mode into a typed error the poll job can act
 * on, because "what do I do now" differs sharply by cause:
 *
 *   RateLimitedError  -> stop, reschedule the job, do not retry in-process
 *   TransientError    -> let pg-boss retry with backoff
 *   SchemaError       -> the provider changed its payload; fail loudly
 *   AdapterError      -> the provider rejected the request; usually skippable
 */
import { z } from "zod";

export class AdapterError extends Error {
  readonly source: string;
  constructor(source: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AdapterError";
    this.source = source;
  }
}

/** The provider told us to slow down. Carries when it is safe to return. */
export class RateLimitedError extends AdapterError {
  readonly retryAfterSeconds: number;
  constructor(source: string, retryAfterSeconds: number) {
    super(source, `${source} rate limited; retry in ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The provider answered, but not in the shape we expect.
 *
 * Distinct from a plain `AdapterError` because the two demand opposite
 * handling: a request the provider *rejected* (a mistyped site name, a deleted
 * subreddit) should usually be skipped so the rest of the poll survives, while
 * a payload that no longer validates means the contract changed underneath us
 * and must fail loudly. Silently skipping that would show up as a source that
 * quietly stopped returning anything.
 */
export class SchemaError extends AdapterError {
  constructor(source: string, message: string, options?: { cause?: unknown }) {
    super(source, message, options);
    this.name = "SchemaError";
  }
}

/** A timeout, a 5xx, a dropped socket. Worth retrying as-is. */
export class TransientError extends AdapterError {
  constructor(source: string, message: string, options?: { cause?: unknown }) {
    super(source, message, options);
    this.name = "TransientError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export interface RequestOptions {
  source: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * Fetch and parse JSON, or throw one of the errors above.
 *
 * Deliberately does not retry: retrying is pg-boss's job, and a retry loop
 * hidden in here would multiply against the queue's own retries.
 */
export async function fetchJson<T>(
  options: RequestOptions,
  schema: z.ZodType<T>,
): Promise<T> {
  const { source, url, method = "GET", headers, body } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      ...(headers === undefined ? {} : { headers }),
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    // A timeout or a dead socket is worth another attempt later.
    throw new TransientError(
      source,
      `request to ${redactUrl(url)} failed`,
      { cause },
    );
  }

  if (response.status === 429) {
    throw new RateLimitedError(source, readRetryAfter(response));
  }

  // 5xx is the provider's problem and usually passes. 4xx is ours and will not.
  if (response.status >= 500) {
    throw new TransientError(
      source,
      `${redactUrl(url)} returned ${response.status}`,
    );
  }

  if (!response.ok) {
    throw new AdapterError(
      source,
      `${redactUrl(url)} returned ${response.status} ${response.statusText}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new AdapterError(source, `${redactUrl(url)} returned invalid JSON`, {
      cause,
    });
  }

  // Validate at the boundary: a silent provider shape change must fail here,
  // not turn into an undefined halfway through a digest.
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new SchemaError(
      source,
      `${redactUrl(url)} returned an unexpected shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

function readRetryAfter(response: Response): number {
  const header =
    response.headers.get("retry-after") ??
    response.headers.get("x-ratelimit-reset");
  if (header === null) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    // Cap it: a provider asking for an hour should not park a job that long.
    return Math.min(seconds, 900);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/** Keep query strings out of error messages — they can carry tokens. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}
