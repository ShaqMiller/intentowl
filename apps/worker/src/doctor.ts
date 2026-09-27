/**
 * Production readiness check (`pnpm cli doctor`).
 *
 * One command that answers "is anything broken right now", by talking to the
 * real services rather than reading config and hoping. Every check prints
 * green (fine), yellow (works, but something is missing or degraded) or red
 * (broken, a customer would notice). The exit code is 1 if anything is red,
 * so CI or a cron can use it too.
 *
 * Read-only by design: nothing here sends an email, writes a row, charges a
 * card or changes a setting. The one exception is opt-in and costs a fraction
 * of a cent — see `--spend` below, which is the only way to tell an Anthropic
 * key that works from an account that has run out of credit.
 *
 * It checks what this machine can see. Variables set only in Vercel or Railway
 * are not visible here, so a missing web variable is reported as a warning
 * with a note, not as a failure.
 */
import { createDb, type Db } from "@intentowl/db";
import { sql } from "drizzle-orm";

import { env } from "./env.ts";

// --- output -----------------------------------------------------------------

const RESET = "\u001B[0m";
const COLOURS = {
  ok: "\u001B[32m", // green
  warn: "\u001B[33m", // yellow
  fail: "\u001B[31m", // red
  dim: "\u001B[90m",
  bold: "\u001B[1m",
} as const;

type Level = "ok" | "warn" | "fail";

const LABEL: Record<Level, string> = { ok: " OK ", warn: "WARN", fail: "FAIL" };

const tally: Record<Level, number> = { ok: 0, warn: 0, fail: 0 };

/** Colour is dropped when the output is piped or NO_COLOR is set. */
const useColour = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

function paint(text: string, colour: keyof typeof COLOURS): string {
  return useColour ? `${COLOURS[colour]}${text}${RESET}` : text;
}

function report(level: Level, name: string, detail: string): void {
  tally[level] += 1;
  const tag = paint(`[${LABEL[level]}]`, level);
  const note = detail === "" ? "" : ` ${paint("—", "dim")} ${detail}`;
  process.stdout.write(`  ${tag} ${name}${note}\n`);
}

function section(title: string): void {
  process.stdout.write(`\n${paint(title, "bold")}\n`);
}

/** Run one check; an unexpected throw is a red rather than a crashed script. */
async function check(name: string, fn: () => Promise<[Level, string]>): Promise<void> {
  try {
    const [level, detail] = await fn();
    report(level, name, detail);
  } catch (error) {
    report("fail", name, error instanceof Error ? error.message : String(error));
  }
}

// --- helpers ----------------------------------------------------------------

const TIMEOUT_MS = 12_000;

async function request(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: string; finalUrl: string }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: response.status, body: await response.text(), finalUrl: response.url };
}

function asJson(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function minutesSince(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const at = new Date(String(value)).getTime();
  return Number.isNaN(at) ? null : Math.round((Date.now() - at) / 60_000);
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Record<
    string,
    unknown
  >[];
}

/** Web-only variables live in Vercel; locally they may simply be absent. */
function webVar(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

// --- checks -----------------------------------------------------------------

async function checkEnvironment(): Promise<void> {
  section("Environment");

  await check("DATABASE_URL", async () =>
    env.DATABASE_URL === "" ? ["fail", "not set"] : ["ok", "set"],
  );

  await check("APP_URL", async () => ["ok", env.APP_URL]);

  await check("DIGEST_FROM", async () => {
    const value = env.DIGEST_FROM;
    if (value.includes("onboarding@resend.dev")) {
      return ["warn", `${value} — Resend's sandbox sender only reaches your own address`];
    }
    return ["ok", value];
  });

  await check("DIGEST_REPLY_TO", async () =>
    env.DIGEST_REPLY_TO === undefined
      ? ["warn", "unset: replies to a digest are lost, and the site promises replies work"]
      : ["ok", env.DIGEST_REPLY_TO],
  );

  await check("FEEDBACK_SECRET", async () => {
    const secret = process.env["FEEDBACK_SECRET"];
    if (secret === undefined || secret === "") {
      return ["fail", "unset: digest rating links cannot be signed"];
    }
    if (secret.length < 16) return ["fail", "shorter than 16 characters"];
    return ["ok", "set — must match the same value in Vercel"];
  });

  for (const [name, note] of [
    ["ANTHROPIC_API_KEY", "classification and the setup wizard stop without it"],
    ["RESEND_API_KEY", "no digest can be sent"],
  ] as const) {
    await check(name, async () =>
      process.env[name] === undefined || process.env[name] === ""
        ? ["fail", `unset: ${note}`]
        : ["ok", "set"],
    );
  }

  for (const [name, note] of [
    ["GITHUB_TOKEN", "3 search terms per poll instead of 10"],
    ["STACKEXCHANGE_KEY", "300 requests/day shared, instead of 10,000"],
    ["OPS_ALERT_EMAIL", "watchdog alerts fall back to DIGEST_REPLY_TO"],
    ["ONBOARDING_FORM_URL", "the thank-you page drops its 'hand it over' option"],
  ] as const) {
    await check(name, async () =>
      webVar(name) === undefined ? ["warn", `unset: ${note}`] : ["ok", "set"],
    );
  }

  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_LINK_STARTER_MONTHLY",
    "STRIPE_LINK_STARTER_ANNUAL",
    "STRIPE_LINK_PRO_MONTHLY",
    "STRIPE_LINK_PRO_ANNUAL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
  ]) {
    await check(name, async () =>
      webVar(name) === undefined
        ? ["warn", "not set on this machine — confirm it is set in Vercel"]
        : ["ok", "set"],
    );
  }
}

async function checkDatabase(db: Db): Promise<void> {
  section("Database");

  await check("connection", async () => {
    const started = Date.now();
    await db.execute(sql`select 1`);
    return ["ok", `responded in ${Date.now() - started}ms`];
  });

  await check("migrations", async () => {
    const applied = rowsOf(
      await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`),
    );
    const sources = rowsOf(
      await db.execute(sql`select unnest(enum_range(null::source))::text as source`),
    ).map((row) => String(row["source"]));
    const missing = ["reddit", "hn", "lobsters", "stackexchange", "bluesky", "rss", "github"].filter(
      (source) => !sources.includes(source),
    );
    if (missing.length > 0) return ["fail", `source enum is missing: ${missing.join(", ")}`];
    return ["ok", `${String(applied[0]?.["n"] ?? "?")} applied, source enum current`];
  });

  await check("customers", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select count(*) filter (where status = 'active')::int as active,
               count(*)::int as total from customers`),
    );
    const active = Number(rows[0]?.["active"] ?? 0);
    return [active > 0 ? "ok" : "warn", `${active} active of ${String(rows[0]?.["total"] ?? 0)}`];
  });

  await check("active searches", async () => {
    const rows = rowsOf(
      await db.execute(sql`select count(*)::int as n from watches where active`),
    );
    const n = Number(rows[0]?.["n"] ?? 0);
    return [n > 0 ? "ok" : "warn", `${n} running`];
  });
}

async function checkPipeline(db: Db): Promise<void> {
  section("Pipeline");

  await check("worker heartbeat", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select max(completed_on) as last from pgboss.job
        where name = 'heartbeat' and state = 'completed'`),
    );
    const mins = minutesSince(rows[0]?.["last"]);
    if (mins === null) return ["fail", "no heartbeat has ever completed"];
    if (mins > 15) return ["fail", `last heartbeat ${mins} minutes ago; the worker looks down`];
    if (mins > 5) return ["warn", `last heartbeat ${mins} minutes ago`];
    return ["ok", `${mins} minute(s) ago`];
  });

  await check("failed jobs (2h)", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select name, count(*)::int as n from pgboss.job
        where state = 'failed' and created_on > now() - interval '2 hours'
        group by name order by 2 desc`),
    );
    if (rows.length === 0) return ["ok", "none"];
    const summary = rows.map((row) => `${String(row["name"])}×${String(row["n"])}`).join(", ");
    return ["fail", summary];
  });

  await check("classify backlog", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select count(*)::int as pending, min(i.fetched_at) as oldest
        from item_watches iw
        join items i on i.id = iw.item_id
        left join classifications c on c.item_id = iw.item_id and c.watch_id = iw.watch_id
        where c.item_id is null and iw.filtered_at is null`),
    );
    const pending = Number(rows[0]?.["pending"] ?? 0);
    const mins = minutesSince(rows[0]?.["oldest"]);
    if (pending === 0) return ["ok", "empty"];
    if (mins !== null && mins > 120) {
      return ["fail", `${pending} waiting, oldest ${Math.round(mins / 60)}h — check Anthropic credit`];
    }
    return ["ok", `${pending} waiting, oldest ${mins ?? "?"} min`];
  });

  await check("open alerts", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select key, level from ops_alerts where resolved_at is null order by level, key`),
    );
    if (rows.length === 0) return ["ok", "none"];
    const keys = rows.map((row) => String(row["key"])).join(", ");
    return [rows.some((row) => row["level"] === "error") ? "fail" : "warn", keys];
  });

  await check("digests (24h)", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select count(*)::int as n, sum(item_count)::int as leads from digests
        where sent_at > now() - interval '24 hours'`),
    );
    const n = Number(rows[0]?.["n"] ?? 0);
    if (n === 0) return ["warn", "none sent in the last day"];
    return ["ok", `${n} sent, ${String(rows[0]?.["leads"] ?? 0)} leads total`];
  });

  await check("source freshness", async () => {
    const active = new Set(
      rowsOf(
        await db.execute(sql`
          select distinct unnest(sources)::text as source from watches where active`),
      ).map((row) => String(row["source"])),
    );
    const rows = rowsOf(
      await db.execute(sql`
        select source::text as source, max(fetched_at) as newest from items group by source`),
    ).filter((row) => active.has(String(row["source"])));
    const stale = rows
      .map((row) => ({ source: String(row["source"]), mins: minutesSince(row["newest"]) }))
      .filter((row) => row.mins === null || row.mins > 180);
    const fresh = rows.length - stale.length;
    if (rows.length === 0) return ["warn", "no active source has ever fetched"];
    if (stale.length > 0) {
      return ["warn", `${fresh} fresh; quiet: ${stale.map((s) => `${s.source} ${s.mins}m`).join(", ")}`];
    }
    return ["ok", `${fresh} source(s) fetched within 3h`];
  });
}

async function checkAnthropic(spend: boolean): Promise<void> {
  section("Anthropic");
  const key = process.env["ANTHROPIC_API_KEY"];
  if (key === undefined || key === "") {
    report("fail", "api key", "unset");
    return;
  }

  const headers: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    ...(env.ANTHROPIC_WORKSPACE_ID === undefined
      ? {}
      : { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID }),
  };

  await check("key accepted", async () => {
    const { status, body } = await request("https://api.anthropic.com/v1/models?limit=1", {
      headers,
    });
    if (status === 200) return ["ok", "authenticated"];
    return ["fail", `${status} ${body.slice(0, 160)}`];
  });

  if (!spend) {
    report("warn", "credit balance", "not checked — re-run with --spend (costs ~$0.00002)");
    return;
  }

  await check("credit balance", async () => {
    const { status, body } = await request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (status === 200) return ["ok", "a real call succeeded"];
    const message = String(
      (asJson(body)["error"] as { message?: string } | undefined)?.message ?? body.slice(0, 160),
    );
    if (/credit balance/i.test(message)) {
      return ["fail", "out of credit — classification is stopped until you top up"];
    }
    return ["fail", `${status} ${message}`];
  });
}

async function checkResend(): Promise<void> {
  section("Resend");
  const key = process.env["RESEND_API_KEY"];
  if (key === undefined || key === "") {
    report("fail", "api key", "unset: no digest can be sent");
    return;
  }

  const domains = await request("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${key}` },
  });

  // A send-only key is the right kind of key to deploy, and it cannot list
  // domains — so that 401 is a pass, not a failure.
  const restricted = /restricted_api_key/.test(domains.body);

  await check("key accepted", async () => {
    if (domains.status === 200) return ["ok", "authenticated, full access"];
    if (restricted) return ["ok", "authenticated, send-only key"];
    return ["fail", `${domains.status} ${domains.body.slice(0, 160)}`];
  });

  if (domains.status !== 200) {
    if (restricted) {
      report(
        "warn",
        "sender domain verified",
        "cannot be checked with a send-only key; verify in the Resend dashboard",
      );
    }
    return;
  }

  await check("sender domain verified", async () => {
    const data = (asJson(domains.body)["data"] ?? []) as Array<{ name?: string; status?: string }>;
    const sender = env.DIGEST_FROM.match(/<([^>]+)>/)?.[1] ?? env.DIGEST_FROM;
    const domain = sender.split("@")[1]?.toLowerCase() ?? "";
    if (domain.endsWith("resend.dev")) {
      return ["warn", "sandbox sender: only your own address receives it"];
    }
    const match = data.find((entry) => (entry.name ?? "").toLowerCase() === domain);
    if (match === undefined) {
      return ["fail", `${domain} is not a domain on this Resend account`];
    }
    return match.status === "verified"
      ? ["ok", `${domain} verified`]
      : ["fail", `${domain} is ${match.status ?? "unverified"}`];
  });
}

async function checkStripe(): Promise<void> {
  section("Stripe");
  const key = webVar("STRIPE_SECRET_KEY");
  if (key === undefined) {
    report("warn", "secret key", "not set here — confirm it is set in Vercel, then re-run there");
    return;
  }

  const auth = { authorization: `Bearer ${key}` };
  const account = await request("https://api.stripe.com/v1/account", { headers: auth });

  await check("key accepted", async () => {
    if (account.status !== 200) return ["fail", `${account.status} ${account.body.slice(0, 160)}`];
    const data = asJson(account.body);
    const live = key.startsWith("sk_live_");
    const charges = data["charges_enabled"] === true;
    if (live && !charges) return ["fail", "live key, but the account cannot take charges yet"];
    return [live ? "ok" : "warn", live ? "live mode, charges enabled" : "TEST mode key"];
  });

  if (account.status !== 200) return;

  const links = await request("https://api.stripe.com/v1/payment_links?limit=100", { headers: auth });
  const known = ((asJson(links.body)["data"] ?? []) as Array<{ url?: string; active?: boolean }>).filter(
    (entry) => typeof entry.url === "string",
  );

  for (const name of [
    "STRIPE_LINK_STARTER_MONTHLY",
    "STRIPE_LINK_STARTER_ANNUAL",
    "STRIPE_LINK_PRO_MONTHLY",
    "STRIPE_LINK_PRO_ANNUAL",
  ]) {
    await check(name, async () => {
      const url = webVar(name);
      if (url === undefined) return ["warn", "not set here — confirm it is set in Vercel"];
      const match = known.find((entry) => entry.url === url.replace(/\?.*$/, ""));
      if (match === undefined) {
        return ["fail", "not a Payment Link on this account — wrong mode, or it was deleted"];
      }
      if (match.active !== true) return ["fail", "the Payment Link is deactivated"];
      const { status } = await request(url);
      return status === 200 ? ["ok", "active and reachable"] : ["fail", `checkout page returned ${status}`];
    });
  }

  await check("webhook endpoint", async () => {
    const { status, body } = await request("https://api.stripe.com/v1/webhook_endpoints?limit=100", {
      headers: auth,
    });
    if (status !== 200) return ["fail", `${status} ${body.slice(0, 120)}`];
    const endpoints = (asJson(body)["data"] ?? []) as Array<{
      url?: string;
      status?: string;
      enabled_events?: string[];
    }>;
    const ours = endpoints.filter((entry) => (entry.url ?? "").includes("/api/stripe/webhook"));
    if (ours.length === 0) {
      return ["fail", "none points at /api/stripe/webhook — checkout will create no account"];
    }
    const enabled = ours.find((entry) => entry.status === "enabled");
    if (enabled === undefined) return ["fail", "an endpoint exists but is disabled"];
    const events = enabled.enabled_events ?? [];
    const needed = [
      "checkout.session.completed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ];
    const missing = needed.filter((event) => !events.includes(event) && !events.includes("*"));
    if (missing.length > 0) return ["fail", `missing events: ${missing.join(", ")}`];
    return ["ok", `${enabled.url ?? ""} with all three events`];
  });

  await check("billing portal", async () => {
    const { status, body } = await request(
      "https://api.stripe.com/v1/billing_portal/configurations?limit=10",
      { headers: auth },
    );
    if (status !== 200) return ["fail", `${status} ${body.slice(0, 120)}`];
    const configs = (asJson(body)["data"] ?? []) as Array<{ active?: boolean; is_default?: boolean }>;
    if (!configs.some((entry) => entry.active === true)) {
      return ["fail", "no active configuration — 'Manage billing' will fail"];
    }
    return ["ok", `${configs.length} configuration(s)`];
  });

  await check("webhook signing secret", async () => {
    const secret = webVar("STRIPE_WEBHOOK_SECRET");
    if (secret === undefined) return ["warn", "not set here — confirm it is set in Vercel"];
    return secret.startsWith("whsec_") ? ["ok", "set"] : ["fail", "does not look like a signing secret"];
  });
}

async function checkSupabase(): Promise<void> {
  section("Supabase auth");
  const url = webVar("SUPABASE_URL");
  const anon = webVar("SUPABASE_ANON_KEY");
  if (url === undefined || anon === undefined) {
    report("warn", "credentials", "not set here — confirm both are set in Vercel");
    return;
  }

  await check("auth reachable", async () => {
    const { status } = await request(`${url.replace(/\/$/, "")}/auth/v1/health`, {
      headers: { apikey: anon },
    });
    return status === 200 ? ["ok", "healthy"] : ["fail", `health check returned ${status}`];
  });
}

async function checkWeb(appUrl: string): Promise<void> {
  section(`Web (${appUrl})`);

  const pages: Array<[string, string]> = [
    ["/", "landing"],
    ["/signup", "signup"],
    ["/login", "login"],
    ["/login/claim", "set password"],
    ["/login/reset", "reset password"],
    ["/privacy", "privacy"],
    ["/thanks", "thank you"],
  ];

  for (const [path, name] of pages) {
    await check(`GET ${path}`, async () => {
      const { status } = await request(`${appUrl}${path}`);
      return status === 200 ? ["ok", name] : ["fail", `returned ${status}`];
    });
  }

  await check("GET /dashboard", async () => {
    const { status, finalUrl } = await request(`${appUrl}/dashboard`);
    if (status === 200 && /\/login/.test(finalUrl)) return ["ok", "signed out visitors are sent to /login"];
    if (status === 200) return ["warn", "served a page to a signed-out visitor"];
    return ["fail", `returned ${status}`];
  });

  await check("POST /api/stripe/webhook", async () => {
    const { status } = await request(`${appUrl}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // Unsigned, so a healthy endpoint rejects it. 500 means the env vars are
    // missing; 404 means the route did not deploy.
    if (status === 400) return ["ok", "rejects an unsigned request"];
    if (status === 500) return ["fail", "500 — STRIPE_* variables are missing on the server"];
    if (status === 404) return ["fail", "404 — the route is not deployed"];
    return ["warn", `returned ${status}`];
  });

  await check("signup shows checkout", async () => {
    const { body } = await request(`${appUrl}/signup`);
    if (body.includes("Opening shortly")) {
      return ["fail", "checkout links are missing on the server: nobody can subscribe"];
    }
    return body.includes("buy.stripe.com")
      ? ["ok", "Payment Links are rendering"]
      : ["warn", "no checkout link found in the page"];
  });
}

async function checkSources(): Promise<void> {
  section("Sources");

  await check("hacker news", async () => {
    const { status } = await request("https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=1");
    return status === 200 ? ["ok", "reachable"] : ["fail", `returned ${status}`];
  });

  await check("lobsters", async () => {
    const { status } = await request("https://lobste.rs/newest.json", {
      headers: { "user-agent": "intentowl/0.1" },
    });
    return status === 200 ? ["ok", "reachable"] : ["fail", `returned ${status}`];
  });

  await check("stack exchange", async () => {
    const key = webVar("STACKEXCHANGE_KEY");
    const { status, body } = await request(
      `https://api.stackexchange.com/2.3/info?site=stackoverflow${key === undefined ? "" : `&key=${key}`}`,
    );
    if (status !== 200) return ["fail", `returned ${status}`];
    const quota = Number(asJson(body)["quota_remaining"] ?? 0);
    if (quota < 100) return ["warn", `${quota} requests left today`];
    return ["ok", `${quota} requests left today`];
  });

  await check("github", async () => {
    const token = webVar("GITHUB_TOKEN");
    const { status, body } = await request(
      "https://api.github.com/search/issues?q=test+is:issue&per_page=1&advanced_search=true",
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "intentowl/0.1",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
      },
    );
    if (status !== 200) return ["fail", `returned ${status} ${body.slice(0, 120)}`];
    return token === undefined
      ? ["warn", "reachable, unauthenticated: 3 terms per poll"]
      : ["ok", "reachable with a token: 10 terms per poll"];
  });

  await check("bluesky", async () => {
    if (env.BLUESKY_IDENTIFIER === undefined || env.BLUESKY_APP_PASSWORD === undefined) {
      return ["warn", "credentials unset; the adapter is not registered"];
    }
    const { status } = await request("https://bsky.social/xrpc/_health");
    return status === 200 ? ["ok", "credentials set, service healthy"] : ["warn", `service returned ${status}`];
  });
}

// --- entry point ------------------------------------------------------------

export async function runDoctor(options: { spend?: boolean; appUrl?: string } = {}): Promise<number> {
  const appUrl = (options.appUrl ?? env.APP_URL).replace(/\/$/, "");
  process.stdout.write(paint("\nIntentOwl production check\n", "bold"));
  process.stdout.write(paint(`  ${new Date().toISOString()} · site ${appUrl}\n`, "dim"));

  const { db, pool } = createDb(env.DATABASE_URL);
  try {
    await checkEnvironment();
    await checkDatabase(db);
    await checkPipeline(db);
    await checkAnthropic(options.spend ?? false);
    await checkResend();
    await checkStripe();
    await checkSupabase();
    await checkWeb(appUrl);
    await checkSources();
  } finally {
    await pool.end();
  }

  const summary = `${tally.ok} ok · ${tally.warn} warning(s) · ${tally.fail} failure(s)`;
  process.stdout.write(
    `\n${paint(summary, tally.fail > 0 ? "fail" : tally.warn > 0 ? "warn" : "ok")}\n`,
  );
  if (tally.fail > 0) {
    process.stdout.write(paint("Red items block a paying customer.\n", "dim"));
  }
  return tally.fail > 0 ? 1 : 0;
}
