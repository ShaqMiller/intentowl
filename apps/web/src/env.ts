import { parseEnv } from "@intentowl/core/env";
import { z } from "zod";

/**
 * Web environment. Server-side only — never import this from a client
 * component, and never surface a value from it in rendered output.
 *
 * Stripe keys arrive in M5; until then the landing page needs nothing but
 * APP_URL, so requiring more would make the skeleton unrunnable.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

  // M5 — payments. All optional so the site renders before Stripe is wired.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Payment Link URLs, one per plan and interval, each carrying the 7-day
   * trial. Created in Stripe rather than in code.
   */
  STRIPE_LINK_STARTER_MONTHLY: z.url().optional(),
  STRIPE_LINK_STARTER_ANNUAL: z.url().optional(),
  STRIPE_LINK_PRO_MONTHLY: z.url().optional(),
  STRIPE_LINK_PRO_ANNUAL: z.url().optional(),
  /** Tally/Google form the thank-you page sends people to. */
  ONBOARDING_FORM_URL: z.url().optional(),

  // M7 — auth. Optional so the marketing site still builds without them, but
  // `requireCustomer` refuses to serve the dashboard in production unless the
  // first two are present. See src/session.ts.
  SUPABASE_URL: z.url().optional(),
  /** Publishable key. Safe to expose; row-level security is what protects data. */
  SUPABASE_ANON_KEY: z.string().optional(),
  /** Must match the worker's, which signs the links this app verifies. */
  FEEDBACK_SECRET: z.string().min(16).optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = parseEnv(schema);
