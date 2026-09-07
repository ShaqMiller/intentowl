/**
 * The scheduling arithmetic, tested where it is cheap to test.
 *
 * These are copies of the pure helpers in apps/worker/src/jobs/schedules.ts.
 * They live here because packages/core is the only workspace with a test
 * runner wired up, and because the properties being asserted — that a cron
 * fires at the claimed interval, and that DST does not move a local send hour —
 * are the kind that fail silently in production and are invisible in a log.
 */
import { describe, expect, it } from "vitest";

function intervalCron(minutes: number, offset: number): string {
  if (minutes >= 60) return `${offset % 60} * * * *`;
  const start = offset % minutes;
  return `${start}-59/${minutes} * * * *`;
}

function offsetFor(id: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % Math.max(1, modulo);
}

/** Expand the minute field of a `start-59/step` cron. */
function firingMinutes(cron: string): number[] {
  const field = cron.split(" ")[0] ?? "";
  if (!field.includes("/")) return [Number(field)];
  const [range, step] = field.split("/");
  const start = Number((range ?? "").split("-")[0]);
  const out: number[] = [];
  for (let m = start; m < 60; m += Number(step)) out.push(m);
  return out;
}

describe("intervalCron", () => {
  it("fires at the claimed interval", () => {
    const minutes = firingMinutes(intervalCron(12, 3));
    expect(minutes).toEqual([3, 15, 27, 39, 51]);
  });

  it("keeps the offset inside the interval", () => {
    // An offset of 40 on a 15-minute cadence must not produce "40-59/15",
    // which would fire twice an hour instead of four times.
    const minutes = firingMinutes(intervalCron(15, 40));
    expect(minutes).toEqual([10, 25, 40, 55]);
  });

  it("collapses anything hourly or slower to a single firing", () => {
    // 60 does not divide into a repeating minute field without drifting
    // across the hour boundary.
    expect(intervalCron(60, 7)).toBe("7 * * * *");
    expect(firingMinutes(intervalCron(60, 7))).toEqual([7]);
  });

  it("never emits a minute outside 0-59", () => {
    for (const m of [12, 15, 20, 30, 60]) {
      for (let o = 0; o < 200; o += 7) {
        for (const minute of firingMinutes(intervalCron(m, o))) {
          expect(minute).toBeGreaterThanOrEqual(0);
          expect(minute).toBeLessThan(60);
        }
      }
    }
  });
});

describe("offsetFor", () => {
  it("is stable across runs", () => {
    // Schedules are re-synced on every boot; an unstable offset would rewrite
    // every schedule each time the worker restarted.
    expect(offsetFor("watch-a:reddit", 12)).toBe(offsetFor("watch-a:reddit", 12));
  });

  it("spreads different ids across the window", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `watch-${i}:hn`);
    const slots = new Set(ids.map((id) => offsetFor(id, 15)));
    // The point is stagger: a hundred watches must not all wake on the hour.
    expect(slots.size).toBeGreaterThan(8);
  });

  it("stays inside the modulo", () => {
    for (const id of ["a", "watch-1:reddit", "a-very-long-identifier-here"]) {
      expect(offsetFor(id, 12)).toBeLessThan(12);
      expect(offsetFor(id, 60)).toBeLessThan(60);
    }
  });
});

describe("local send hour across a DST boundary", () => {
  /** What UTC hour does 07:00 local fall on, for this zone and date? */
  function utcHourFor(tz: string, isoDate: string): number {
    // Walk the day's UTC hours and find the one that reads as 07:00 locally.
    for (let h = 0; h < 48; h += 1) {
      const when = new Date(`${isoDate}T00:00:00Z`);
      when.setUTCHours(h);
      const local = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        hour: "2-digit",
        hour12: false,
      }).format(when);
      if (Number(local) === 7) return when.getUTCHours();
    }
    throw new Error("no matching hour");
  }

  it("moves the UTC hour when the clocks change, which is the whole point", () => {
    // London: BST in September, GMT in November.
    expect(utcHourFor("Europe/London", "2026-09-07")).toBe(6);
    expect(utcHourFor("Europe/London", "2026-11-07")).toBe(7);

    // New York changes on a different date than the UK.
    expect(utcHourFor("America/New_York", "2026-09-07")).toBe(11);
    expect(utcHourFor("America/New_York", "2026-11-07")).toBe(12);
  });

  it("is why a precomputed UTC hour is a bug, not an optimisation", () => {
    // Storing "06:00 UTC" for a London customer at signup in September means
    // they silently start receiving the digest at 06:00 local in November.
    const september = utcHourFor("Europe/London", "2026-09-07");
    const november = utcHourFor("Europe/London", "2026-11-07");
    expect(september).not.toBe(november);
  });
});
