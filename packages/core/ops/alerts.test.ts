import { describe, expect, it } from "vitest";

import {
  isActionableWarning,
  planAlerts,
  renderAlertEmail,
  RENOTIFY_AFTER_MS,
  type AlertState,
  type Finding,
} from "./alerts.ts";

const NOW = new Date("2026-09-21T18:00:00Z");

const silent: Finding = {
  key: "source_silent:bluesky",
  level: "error",
  title: "bluesky polled 24 times in 6h and returned nothing",
  lines: ["last warning: term rejected (400 ExpiredToken)"],
};

function state(overrides: Partial<AlertState> = {}): AlertState {
  return {
    key: silent.key,
    title: silent.title,
    lastNotifiedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    resolvedAt: null,
    ...overrides,
  };
}

describe("planAlerts", () => {
  it("sends a new problem immediately", () => {
    const plan = planAlerts([silent], [], NOW);
    expect(plan.notify).toEqual([{ ...silent, ongoing: false }]);
    expect(plan.resolve).toEqual([]);
  });

  it("stays quiet about an open problem it reported recently", () => {
    const plan = planAlerts([silent], [state()], NOW);
    expect(plan.notify).toEqual([]);
  });

  it("reminds once a day while a problem lasts", () => {
    const stale = state({ lastNotifiedAt: new Date(NOW.getTime() - RENOTIFY_AFTER_MS) });
    const plan = planAlerts([silent], [stale], NOW);
    expect(plan.notify).toEqual([{ ...silent, ongoing: true }]);
  });

  it("reports a cleared problem once as resolved", () => {
    const open = state();
    const plan = planAlerts([], [open], NOW);
    expect(plan.resolve).toEqual([open]);
    // Already resolved rows are not resolved again.
    expect(planAlerts([], [state({ resolvedAt: NOW })], NOW).resolve).toEqual([]);
  });

  it("treats a problem that comes back after resolving as new", () => {
    const plan = planAlerts([silent], [state({ resolvedAt: new Date(NOW.getTime() - 1000) })], NOW);
    expect(plan.notify).toEqual([{ ...silent, ongoing: false }]);
  });
});

describe("isActionableWarning", () => {
  it("keeps the warnings that mean leads are being lost", () => {
    expect(isActionableWarning('term "x" page 1 was rejected (400 ExpiredToken)')).toBe(true);
    expect(isActionableWarning("daily Threads search budget reached; 3 of 25 terms were not searched")).toBe(true);
    expect(isActionableWarning("5 include term(s) are past this source's per-poll limit and are never searched: a")).toBe(true);
  });

  it("ignores saturation notices", () => {
    expect(isActionableWarning('term "no customers" still had results after 2 pages; some posts were not read')).toBe(false);
  });
});

describe("renderAlertEmail", () => {
  it("leads with the count of open problems and lists resolutions", () => {
    const { subject, text } = renderAlertEmail({
      notify: [{ ...silent, ongoing: false }],
      resolve: [state({ key: "job_failed:poll", title: "poll failed 3 times" })],
    });
    expect(subject).toBe("IntentOwl: 1 problem needs attention, 1 resolved");
    expect(text).toContain("NEW");
    expect(text).toContain("[ERROR] bluesky polled 24 times");
    expect(text).toContain("RESOLVED\n- poll failed 3 times");
  });

  it("says so when everything cleared", () => {
    const { subject } = renderAlertEmail({ notify: [], resolve: [state()] });
    expect(subject).toBe("IntentOwl: 1 problem resolved");
  });
});
