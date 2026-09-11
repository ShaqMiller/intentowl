import { parseEnv } from "@intentowl/core/env";
import { z } from "zod";

/**
 * Worker environment.
 *
 * Only DATABASE_URL is required at M0 — the pipeline that needs the API keys
 * does not exist yet, and demanding them now would make the skeleton
 * unrunnable. Each milestone promotes its own keys from optional to required
 * as the jobs that use them land.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  PORT: z.coerce.number().int().positive().default(8080),

  // M1
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().optional(),
  /** Free key from stackapps.com: raises the daily quota from 300 to 10,000. */
  STACKEXCHANGE_KEY: z.string().optional(),
  // M2
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Only needed when the API key is org-scoped rather than workspace-scoped. */
  ANTHROPIC_WORKSPACE_ID: z.string().optional(),
  // M3
  RESEND_API_KEY: z.string().optional(),
  /** Verified sender. Resend rejects a From on an unverified domain. */
  DIGEST_FROM: z.string().default("IntentOwl <onboarding@resend.dev>"),
  /**
   * Where a customer's reply goes.
   *
   * Needed because the From address lives on the sending subdomain, which has
   * no inbox — its only MX record is the provider's bounce handler. Without a
   * Reply-To, every reply to a digest is silently lost, and "reply to any
   * digest" is the entire support model on the landing page, the settings page
   * and the thank-you page.
   */
  DIGEST_REPLY_TO: z.string().optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  // M6
  BLUESKY_IDENTIFIER: z.string().optional(),
  BLUESKY_APP_PASSWORD: z.string().optional(),
  OPS_SLACK_WEBHOOK_URL: z.url().optional(),
  /**
   * HMAC key for the feedback links in the digest. Optional: without it the
   * digest simply renders no thumbs, rather than rendering links that cannot
   * be verified. Must match the web app, which receives the clicks.
   */
  FEEDBACK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = parseEnv(schema);
