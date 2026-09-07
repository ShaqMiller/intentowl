import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenBucket } from "./rate-limit.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("TokenBucket", () => {
  it("starts full and spends down to empty", () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 });
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it("refills over time, never past capacity", () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1 });
    expect(bucket.tryTake(2)).toBe(true);
    expect(bucket.available).toBeCloseTo(0, 5);

    vi.advanceTimersByTime(1000);
    expect(bucket.available).toBeCloseTo(1, 5);

    // Ten idle seconds must not bank ten tokens on a capacity-2 bucket.
    vi.advanceTimersByTime(10_000);
    expect(bucket.available).toBe(2);
  });

  it("reports how long until enough tokens exist", () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 2 });
    bucket.tryTake(5);
    expect(bucket.delayFor(1)).toBe(500);
    expect(bucket.delayFor(4)).toBe(2000);
  });

  it("take() waits rather than exceeding the budget", async () => {
    vi.useFakeTimers();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 10 });
    bucket.tryTake();

    let granted = false;
    const pending = bucket.take().then(() => {
      granted = true;
    });

    expect(granted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(granted).toBe(true);
  });

  it("drain() empties the bucket so a 429 is not immediately re-offended", () => {
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 1 });
    expect(bucket.available).toBe(10);
    bucket.drain();
    expect(bucket.available).toBeCloseTo(0, 5);
    expect(bucket.tryTake()).toBe(false);
  });

  it("enforces roughly the configured rate over a window", () => {
    vi.useFakeTimers();
    // The Reddit budget: burst 20, sustain 60/min.
    const bucket = new TokenBucket({ capacity: 20, refillPerSecond: 1 });

    let taken = 0;
    for (let i = 0; i < 100; i += 1) if (bucket.tryTake()) taken += 1;
    expect(taken).toBe(20);

    vi.advanceTimersByTime(60_000);
    taken = 0;
    for (let i = 0; i < 100; i += 1) if (bucket.tryTake()) taken += 1;
    // Capped by capacity, comfortably inside Reddit's ~100/min ceiling.
    expect(taken).toBe(20);
  });
});
