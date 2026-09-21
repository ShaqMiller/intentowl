/**
 * Watchdog: finds the failures that do not throw, and emails the operator.
 *
 * Built after Bluesky returned nothing from 15 to 21 September 2026 while
 * every poll completed successfully. The daily ops report would have said so,
 * but it only posts to Slack and no webhook was configured — so nobody heard.
 * This runs every half hour, checks what "working" actually means, and emails
 * through Resend, which is already required for digests.
 *
 * Findings:
 *   source_silent:<source>   polls completing, nothing coming back
 *   poll_warning:<source>    rejected requests, exhausted budgets, unsearched terms
 *   job_failed:<queue>       jobs that failed in the last two hours
 *   classify_backlog         kept posts unclassified for 2h+ (e.g. AI credit ran out)
 *   digest_missing:<id>      an active customer with no digest in 26 hours
 *
 * Deciding what to send lives in @intentowl/core (`planAlerts`), where it is
 * tested; this file only gathers and persists.
 */
import {
  isActionableWarning,
  planAlerts,
  renderAlertEmail,
  sendPlainEmail,
  SILENCE_WINDOW_HOURS,
  type AlertState,
  type Finding,
} from "@intentowl/core";
import { schema, type Db } from "@intentowl/db";
import { inArray, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { DEFAULT_QUEUE_OPTIONS } from "../boss.ts";
import { env } from "../env.ts";
import { logger } from "../logger.ts";
import { notifyOps, withOpsAlert } from "../ops.ts";

export const WATCHDOG_QUEUE = "watchdog";

export const WATCHDOG_QUEUE_OPTIONS = {
  ...DEFAULT_QUEUE_OPTIONS,
  policy: "stately",
  expireInSeconds: 120,
} as const;

/** How far back failed jobs and adapter warnings count as current. */
const RECENT_HOURS = 2;

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] =>
  Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] }).rows ?? []);

export async function gatherFindings(db: Db): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Sources configured on an active search of an active customer.
  const watched = rowsOf(
    await db.execute(sql`
      select distinct unnest(w.sources)::text as source
      from watches w join customers c on c.id = w.customer_id
      where w.active and c.status = 'active'`),
  ).map((r) => String(r["source"]));

  for (const source of watched) {
    const hours = SILENCE_WINDOW_HOURS[source] ?? 12;
    const [stats] = rowsOf(
      await db.execute(sql`
        select
          count(*)::int as polls,
          coalesce(sum((output->>'fetched')::int) filter (where output ? 'fetched'), 0)::int as fetched,
          (select count(*)::int from item_watches iw join items i on i.id = iw.item_id
             where i.source = ${source} and iw.created_at > now() - make_interval(hours => ${hours}::int)) as linked
        from pgboss.job
        where name = 'poll' and state = 'completed' and data->>'source' = ${source}
          and completed_on > now() - make_interval(hours => ${hours}::int)`),
    );
    const polls = Number(stats?.["polls"] ?? 0);
    if (polls >= 2 && Number(stats?.["fetched"] ?? 0) === 0 && Number(stats?.["linked"] ?? 0) === 0) {
      findings.push({
        key: `source_silent:${source}`,
        level: "error",
        title: `${source} polled ${polls} times in ${hours}h and returned nothing`,
        lines: [
          "Every poll completed, so nothing failed loudly. Check the warnings below, the credentials, and the adapter.",
        ],
      });
    }
  }

  // Actionable adapter warnings, from poll outputs.
  const warned = rowsOf(
    await db.execute(sql`
      select data->>'source' as source, w.value as warning
      from pgboss.job, jsonb_array_elements_text(coalesce(output->'warnings', '[]'::jsonb)) as w(value)
      where name = 'poll' and state = 'completed'
        and completed_on > now() - make_interval(hours => ${RECENT_HOURS}::int)`),
  );
  const bySource = new Map<string, Set<string>>();
  for (const r of warned) {
    const warning = String(r["warning"]);
    if (!isActionableWarning(warning)) continue;
    const source = String(r["source"]);
    const set = bySource.get(source) ?? new Set<string>();
    set.add(warning.length > 220 ? `${warning.slice(0, 220)}…` : warning);
    bySource.set(source, set);
  }
  for (const [source, warnings] of bySource) {
    const list = [...warnings];
    findings.push({
      key: `poll_warning:${source}`,
      level: "warn",
      title: `${source} polls are losing results (${list.length} distinct warning${list.length === 1 ? "" : "s"} in ${RECENT_HOURS}h)`,
      lines: list.slice(0, 3),
    });
    // Attach the evidence to a silent-source finding for the same source.
    const silent = findings.find((f) => f.key === `source_silent:${source}`);
    if (silent !== undefined) silent.lines.push(...list.slice(0, 2).map((w) => `warning: ${w}`));
  }

  // Failed jobs.
  for (const r of rowsOf(
    await db.execute(sql`
      select name, count(*)::int as n,
        (array_agg(coalesce(output->>'message', output::text) order by completed_on desc))[1] as last
      from pgboss.job
      where state = 'failed' and completed_on > now() - make_interval(hours => ${RECENT_HOURS}::int)
      group by name`),
  )) {
    const last = String(r["last"] ?? "");
    findings.push({
      key: `job_failed:${String(r["name"])}`,
      level: "error",
      title: `${String(r["name"])} failed ${String(r["n"])} time(s) in the last ${RECENT_HOURS}h`,
      lines: last === "" ? [] : [`latest: ${last.slice(0, 300)}`],
    });
  }

  // Classification backlog.
  const [backlog] = rowsOf(
    await db.execute(sql`
      select count(*)::int as n, min(iw.created_at) as oldest
      from item_watches iw
      join watches w on w.id = iw.watch_id
      left join classifications c on c.item_id = iw.item_id and c.watch_id = iw.watch_id
      where w.active and iw.filtered_at is null and c.item_id is null
        and iw.created_at < now() - interval '2 hours'`),
  );
  const waiting = Number(backlog?.["n"] ?? 0);
  if (waiting > 0) {
    findings.push({
      key: "classify_backlog",
      level: "error",
      title: `${waiting} post(s) have waited 2h+ to be classified`,
      lines: [
        `oldest since ${String(backlog?.["oldest"])}`,
        "If the classify job is not failing, check the Anthropic credit balance and API key.",
      ],
    });
  }

  // Missing digests.
  for (const r of rowsOf(
    await db.execute(sql`
      select c.id, c.email
      from customers c
      where c.status = 'active'
        and c.created_at < now() - interval '26 hours'
        and exists (select 1 from watches w where w.customer_id = c.id and w.active)
        and not exists (select 1 from digests d where d.customer_id = c.id and d.sent_at > now() - interval '26 hours')`),
  )) {
    findings.push({
      key: `digest_missing:${String(r["id"])}`,
      level: "error",
      title: `No digest for ${String(r["email"])} in 26 hours`,
      lines: ["Check the digest schedule and the Resend key."],
    });
  }

  return findings;
}

export async function runWatchdog(
  db: Db,
  now: Date = new Date(),
): Promise<{ findings: number; notified: number; resolved: number; emailed: boolean }> {
  const findings = await gatherFindings(db);
  const states: AlertState[] = await db
    .select({
      key: schema.opsAlerts.key,
      title: schema.opsAlerts.title,
      lastNotifiedAt: schema.opsAlerts.lastNotifiedAt,
      resolvedAt: schema.opsAlerts.resolvedAt,
    })
    .from(schema.opsAlerts);

  const plan = planAlerts(findings, states, now);
  const to = env.OPS_ALERT_EMAIL ?? env.DIGEST_REPLY_TO;
  let emailed = false;

  if (plan.notify.length > 0 || plan.resolve.length > 0) {
    const { subject, text } = renderAlertEmail(plan);

    // Slack too, when configured. Best-effort by design.
    for (const f of plan.notify) {
      await notifyOps({ level: f.level, title: f.ongoing ? `Still open: ${f.title}` : f.title, lines: f.lines });
    }

    if (env.RESEND_API_KEY !== undefined && to !== undefined) {
      const result = await sendPlainEmail({
        apiKey: env.RESEND_API_KEY,
        from: env.DIGEST_FROM,
        to,
        subject,
        text,
      });
      // Nothing below is persisted if the email failed, so the next run sends
      // it again instead of believing the operator was told.
      if (!result.ok) throw new Error(`watchdog email failed: ${result.error ?? "unknown"}`);
      emailed = true;
    } else {
      logger.warn("watchdog has alerts but no RESEND_API_KEY or OPS_ALERT_EMAIL/DIGEST_REPLY_TO to send them to");
    }
  }

  const notified = new Set(plan.notify.map((f) => f.key));
  for (const f of findings) {
    const detail = f.lines.join("\n");
    await db
      .insert(schema.opsAlerts)
      .values({
        key: f.key,
        level: f.level,
        title: f.title,
        detail,
        firstSeenAt: now,
        lastSeenAt: now,
        lastNotifiedAt: notified.has(f.key) ? now : null,
        resolvedAt: null,
      })
      .onConflictDoUpdate({
        target: schema.opsAlerts.key,
        set: {
          level: f.level,
          title: f.title,
          detail,
          lastSeenAt: now,
          resolvedAt: null,
          // A reopened alert restarts its history.
          firstSeenAt: sql`case when ${schema.opsAlerts.resolvedAt} is null then ${schema.opsAlerts.firstSeenAt} else ${now.toISOString()}::timestamptz end`,
          ...(notified.has(f.key) ? { lastNotifiedAt: now } : {}),
        },
      });
  }
  if (plan.resolve.length > 0) {
    await db
      .update(schema.opsAlerts)
      .set({ resolvedAt: now })
      .where(inArray(schema.opsAlerts.key, plan.resolve.map((s) => s.key)));
  }

  return { findings: findings.length, notified: plan.notify.length, resolved: plan.resolve.length, emailed };
}

export async function registerWatchdog(boss: PgBoss, db: Db): Promise<void> {
  await boss.createQueue(WATCHDOG_QUEUE, WATCHDOG_QUEUE_OPTIONS);

  await boss.work(
    WATCHDOG_QUEUE,
    { batchSize: 1 },
    withOpsAlert(WATCHDOG_QUEUE, async () => {
      const outcome = await runWatchdog(db);
      if (outcome.notified > 0 || outcome.resolved > 0) logger.info(outcome, "watchdog sent alerts");
    }),
  );

  logger.info({ queue: WATCHDOG_QUEUE }, "watchdog worker registered");
}

/** For the CLI: current findings without sending or persisting anything. */
export async function previewWatchdog(db: Db): Promise<Finding[]> {
  return gatherFindings(db);
}

