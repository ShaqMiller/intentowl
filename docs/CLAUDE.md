# CLAUDE.md — Intent-Lead Tool

Community intent-lead digest for SaaS founders: monitor Reddit/HN/Bluesky for
buying-intent posts matching a customer's ICP, classify with Claude, deliver a
daily digest with suggested reply angles. Concierge-first: multi-tenant pipeline,
no dashboard until post-revenue.

**Read `docs/ARCHITECTURE.md` before writing any code.** It is the source of
truth for topology, schema, job design, and build order. If a request conflicts
with it, flag the conflict instead of silently diverging.

## Milestone discipline (non-negotiable)

- Work on exactly ONE milestone (M0–M7) at a time, in order. Never start the
  next one unprompted.
- A milestone is done only when its exit test from ARCHITECTURE.md §8 passes.
  Demonstrate the passing exit test (command + output) before calling it done.
- One commit per passing milestone minimum. Conventional commits (`feat:`,
  `fix:`, `chore:`).
- Current milestone: **M2** (M0, M1 complete).

## Open items carried forward

- **Reddit API access is unverified.** The adapter is built and covered by
  tests against recorded fixtures, but it has never touched the live API:
  reddit.com/prefs/apps refuses app creation on the owner account. M1 was
  closed on HN evidence instead. Two things still to do: (a) get a script app
  created and run `pnpm cli run-poll --watch=<id> --source=reddit` twice to
  finish M1's literal exit test, (b) file Reddit's commercial-use approval
  request — reviews reportedly take 2–4 weeks and selling digests is
  commercial use (ARCHITECTURE.md §4.10).

## Stack (locked — do not substitute)

- Monorepo: pnpm workspaces + Turborepo. Apps: `apps/web` (Next.js 15 App
  Router), `apps/worker` (plain TS + pg-boss). Shared: `packages/core`,
  `packages/db`.
- Postgres on Supabase. Drizzle ORM — schema lives ONLY in
  `packages/db/schema.ts`; change schema via Drizzle migrations, never raw SQL
  in code or manual edits to generated migrations.
- Jobs/cron/queues: pg-boss. NOT Redis, NOT BullMQ, NOT Vercel crons, NOT
  setInterval loops.
- LLM: Anthropic SDK. Haiku for classification, Sonnet only for the 40–70
  score escalation band. Structured output via tool-use JSON, Zod-validated.
- Email: Resend + React Email. Payments: Stripe Payment Links (MVP).
- Validation: Zod at every boundary (env, adapter payloads, LLM output, forms).
- No new runtime dependencies without asking. No NestJS, tRPC, Redis,
  embeddings/vector DB, or microservices.

## Code conventions

- TypeScript strict mode; no `any`, no non-null assertions to silence errors.
- Env vars: read only through the Zod-validated `env.ts` in each app; crash at
  boot on missing config. Never hardcode or log secrets.
- All external I/O lives in `packages/core/adapters`. Filter and scoring
  (`filter/`, `scoring.ts`) stay pure functions — no I/O, unit-tested.
- Every job must be idempotent: upserts + unique indexes, digest sends check
  `digests` for today before sending. A retried job must never double-insert
  or double-send.
- Rate limits are enforced in the adapter layer (shared token bucket for
  Reddit, ~60 req/min budget). Back off on 429s by rescheduling the job.
- Log with pino, structured JSON, include `customer_id`/`watch_id` where known.
- Record every external API call and LLM token count to `api_usage`.

## Testing

- `pnpm eval` runs the classifier against the golden set in
  `packages/core/classify/evals/`. Run it after ANY change to the rubric,
  prompt, or classification schema; do not merge rubric changes that drop
  precision below the recorded baseline.
- Unit tests for filter rules, scoring, dedup. Adapter tests use recorded
  fixtures (msw) — never hit live APIs in tests.
- No E2E suite in MVP. Digest verification is `cli.ts send-digest --dry-run`.

## Commands

- `pnpm dev` — web + worker in watch mode
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- `pnpm eval` — classifier golden-set evals
- `pnpm cli run-poll --watch=<id>` / `pnpm cli send-digest --customer=<id> [--dry-run]`
- `pnpm cli classify-batch` — drain the backlog through the Batch API at 50% off
- `pnpm cli seed --file=<customer.json>` — onboard a customer

(Wire these scripts up in M0/M1 if missing.)

## Hard rules

- NEVER build auto-posting of replies to any platform. The product drafts
  reply angles; a human sends them.
- Stay inside free API tiers: narrow watches (5–15 subreddits), no X adapter
  until it's a paid add-on with per-customer read caps.
- Silence is the unacceptable failure mode: a degraded digest (source down,
  classifier down → keyword-only, flagged) still sends.
- Don't build ahead of the milestone: no auth, no dashboard, no Slack OAuth
  app, no realtime alerts until M7 says so.
