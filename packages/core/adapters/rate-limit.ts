/**
 * Shared token-bucket rate limiting (ARCHITECTURE.md section 4.1 and 4.10).
 *
 * The budget belongs to the *source*, not to a customer or a job: Reddit
 * measures our whole OAuth client against one ceiling, so ten customers polling
 * at once must draw from one bucket. That is why the bucket is a module-level
 * singleton rather than something the caller constructs.
 *
 * The incumbent in this space died of API licensing, so staying visibly inside
 * the free tier is a product requirement, not an optimisation.
 */

export class TokenBucket {
  readonly capacity: number;
  readonly refillPerSecond: number;

  #tokens: number;
  #lastRefill: number;

  constructor(options: { capacity: number; refillPerSecond: number }) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.#tokens = options.capacity;
    this.#lastRefill = Date.now();
  }

  /** Tokens available right now, after accounting for elapsed time. */
  get available(): number {
    this.#refill();
    return this.#tokens;
  }

  /** Milliseconds until `count` tokens are available. 0 if they already are. */
  delayFor(count: number): number {
    this.#refill();
    if (this.#tokens >= count) return 0;
    return Math.ceil(((count - this.#tokens) / this.refillPerSecond) * 1000);
  }

  /** Take `count` tokens if present. Never blocks. */
  tryTake(count = 1): boolean {
    this.#refill();
    if (this.#tokens < count) return false;
    this.#tokens -= count;
    return true;
  }

  /**
   * Wait until `count` tokens are free, then take them.
   *
   * Waiting inside the adapter is correct for the sub-second gaps a token
   * bucket produces. A 429 from the server is a different matter: that is a
   * signal to stop and let the job reschedule itself, which is why it is an
   * error rather than a longer sleep.
   */
  async take(count = 1): Promise<void> {
    for (;;) {
      const delay = this.delayFor(count);
      if (delay === 0) {
        this.#tokens -= count;
        return;
      }
      await sleep(delay);
    }
  }

  /**
   * Drop tokens without granting them — used to absorb a 429 so the next job
   * to run starts from a drained bucket rather than immediately re-offending.
   */
  drain(): void {
    this.#refill();
    this.#tokens = 0;
  }

  #refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.#lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.#tokens = Math.min(
      this.capacity,
      this.#tokens + elapsedSeconds * this.refillPerSecond,
    );
    this.#lastRefill = now;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reddit's free tier allows roughly 100 queries/minute per OAuth client.
 * We budget 60 and keep a burst ceiling well under the limit so a
 * many-subreddit watch cannot spike into a 429 on its first pass.
 */
export const redditBucket = new TokenBucket({
  capacity: 20,
  refillPerSecond: 1,
});

/**
 * HN's Algolia endpoint is free and unauthenticated but explicitly asks for
 * restraint. 10/min is far more than the pipeline needs.
 */
export const hnBucket = new TokenBucket({
  capacity: 5,
  // One a second: 3,600/hour against Algolia's published 10,000/hour per IP.
  // At the old 10/minute a 25-term watch outlasted the poll job's five-minute
  // expiry before it finished searching.
  refillPerSecond: 1,
});
