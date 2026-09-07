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
  // M2
  ANTHROPIC_API_KEY: z.string().optional(),
  // M3
  RESEND_API_KEY: z.string().optional(),
  APP_URL: z.url().default("http://localhost:3000"),
  // M6
  BLUESKY_IDENTIFIER: z.string().optional(),
  BLUESKY_APP_PASSWORD: z.string().optional(),
  OPS_SLACK_WEBHOOK_URL: z.url().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = parseEnv(schema);
