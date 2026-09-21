/**
 * Operator alerting decisions — pure, so the rules are testable without a
 * database or an inbox.
 *
 * The watchdog job gathers *findings* (things wrong right now) every half hour.
 * This module decides which of them deserve an email:
 *
 *   - a new problem: immediately
 *   - a problem still open: again at most once a day, marked as ongoing
 *   - a problem that has gone away: once, as resolved
 *
 * Without that, a half-hourly check either spams (48 emails a day about one
 * outage) or goes quiet after the first mail, which is how a week-long Bluesky
 * outage in September 2026 looked like a run of quiet days.
 */

export type AlertLevel = "warn" | "error";

export interface Finding {
  /** Stable identity, e.g. `source_silent:bluesky`. */
  key: string;
  level: AlertLevel;
  title: string;
  lines: string[];
}

/** What the database remembers about an alert. */
export interface AlertState {
  key: string;
  title: string;
  lastNotifiedAt: Date | null;
  resolvedAt: Date | null;
}

export interface AlertPlan {
  /** Findings to send now. `ongoing` means it was already reported before. */
  notify: Array<Finding & { ongoing: boolean }>;
  /** Open alerts no longer found: report once as resolved. */
  resolve: AlertState[];
}

export const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;

export function planAlerts(
  findings: readonly Finding[],
  states: readonly AlertState[],
  now: Date,
  renotifyAfterMs: number = RENOTIFY_AFTER_MS,
): AlertPlan {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const current = new Set(findings.map((f) => f.key));

  const notify: AlertPlan["notify"] = [];
  for (const finding of findings) {
    const state = byKey.get(finding.key);
    const open = state !== undefined && state.resolvedAt === null;
    if (!open) {
      notify.push({ ...finding, ongoing: false });
      continue;
    }
    const last = state.lastNotifiedAt?.getTime() ?? 0;
    if (now.getTime() - last >= renotifyAfterMs) {
      notify.push({ ...finding, ongoing: true });
    }
  }

  const resolve = states.filter((s) => s.resolvedAt === null && !current.has(s.key));
  return { notify, resolve };
}

/**
 * How long a source may poll successfully while returning nothing before it
 * counts as silent. Busy sources get six hours; slow ones get longer, because
 * Stack Exchange genuinely goes a quiet day without a matching question.
 */
export const SILENCE_WINDOW_HOURS: Record<string, number> = {
  hn: 6,
  bluesky: 6,
  reddit: 6,
  lobsters: 12,
  threads: 12,
  stackexchange: 24,
  x: 24,
  rss: 48,
};

/**
 * Adapter warnings worth waking someone for. Saturation notices ("still had
 * results after 2 pages") are informational; a rejected request, an exhausted
 * budget or a term that is never searched means leads are being lost.
 */
export function isActionableWarning(warning: string): boolean {
  return /rejected|budget reached|never searched/i.test(warning);
}

export function renderAlertEmail(plan: AlertPlan): { subject: string; text: string } {
  const fresh = plan.notify.filter((f) => !f.ongoing);
  const ongoing = plan.notify.filter((f) => f.ongoing);
  const open = plan.notify.length;

  const subject =
    open > 0
      ? `IntentOwl: ${open} problem${open === 1 ? "" : "s"} need${open === 1 ? "s" : ""} attention` +
        (plan.resolve.length > 0 ? `, ${plan.resolve.length} resolved` : "")
      : `IntentOwl: ${plan.resolve.length} problem${plan.resolve.length === 1 ? "" : "s"} resolved`;

  const section = (heading: string, findings: readonly Finding[]): string[] =>
    findings.length === 0
      ? []
      : [
          heading,
          ...findings.flatMap((f) => [
            `- [${f.level.toUpperCase()}] ${f.title}`,
            ...f.lines.map((line) => `    ${line}`),
          ]),
          "",
        ];

  const text = [
    ...section("NEW", fresh),
    ...section("STILL OPEN (reminder, at most once a day)", ongoing),
    ...(plan.resolve.length === 0
      ? []
      : ["RESOLVED", ...plan.resolve.map((s) => `- ${s.title}`), ""]),
    "The watchdog checks every 30 minutes. You hear about a problem when it",
    "starts, once a day while it lasts, and once when it clears.",
  ].join("\n");

  return { subject, text };
}
