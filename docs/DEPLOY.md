# Deploying IntentOwl

Two services, two platforms, for the reason in ARCHITECTURE.md §2: the web app
is request-shaped and the worker is always-on.

| | Platform | Why |
|---|---|---|
| `apps/web` | Vercel | Next.js, bursty traffic, scales to zero |
| `apps/worker` | Railway | Long-lived process, in-memory rate limiters, cron |

Postgres is Supabase and is already live — neither platform hosts data.

---

## Before either platform

DNS and mail should be done first; the URLs below depend on them.

- [x] Domain on Cloudflare
- [x] Cloudflare Email Routing (inbound `tools@intentowl.com` → Gmail)
- [x] Resend verified on `intentowl.com` (its DKIM signs for the root; the
      `send.` subdomain Resend adds is the Return-Path, which is what keeps its
      SPF clear of Cloudflare Email Routing's)
- [ ] **DMARC record** — still missing, see the bottom of this file
- [x] Code on GitHub

---

## Vercel — the web app

1. Sign up with GitHub, import `ShaqMiller/intentowl`
2. **Root Directory: `apps/web`.** Vercel detects Next.js but guesses the repo
   root in a monorepo, and the build fails confusingly if this is wrong.
3. Leave build and install commands on their defaults — Vercel handles pnpm
   workspaces once the root directory is right.
4. Environment variables:

   ```
   DATABASE_URL           Supabase TRANSACTION pooler, port 6543 — not 5432
   SUPABASE_URL           https://bjrwwgwpmsfvfahficzn.supabase.co
   SUPABASE_ANON_KEY      the anon/publishable key
   FEEDBACK_SECRET        must match the worker's exactly
   APP_URL                https://intentowl.com
   STRIPE_SECRET_KEY      live key, once Stripe is activated
   STRIPE_WEBHOOK_SECRET  from the endpoint created in step 6
   STRIPE_LINK_STARTER_MONTHLY   live Payment Link, $15/mo, 7-day trial
   STRIPE_LINK_STARTER_ANNUAL    live Payment Link, $150/yr, 7-day trial
   STRIPE_LINK_PRO_MONTHLY       live Payment Link, $39/mo, 7-day trial
   STRIPE_LINK_PRO_ANNUAL        live Payment Link, $390/yr, 7-day trial
   ANTHROPIC_API_KEY      same key as the worker; the setup wizard drafts a
                          new customer's profile with it. Without it the
                          wizard still works, as a form filled in by hand.
   ANTHROPIC_WORKSPACE_ID only if the worker needs it too
   ```

5. **Domain**: Settings → Domains → add `intentowl.com` and `www`. Vercel
   prints the DNS records it wants. In Cloudflare, **delete the Namecheap
   parking records first** — the `A` to `192.64.119.99` and the `www` CNAME to
   `parkingpage.namecheap.com` — then add Vercel's, set to **DNS only** (grey
   cloud) rather than Proxied while the certificate is issued.
6. **Stripe webhook**: in Stripe, create an endpoint at
   `https://intentowl.com/api/stripe/webhook` subscribed to
   `checkout.session.completed`, `customer.subscription.updated` and
   `customer.subscription.deleted`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`. Until this exists, a real payment creates no
   customer row.
7. **Customer portal** (Settings → Billing → "Manage billing"): a portal
   configuration named "IntentOwl self-serve" exists in **test mode**
   (`bpc_1UIBUbRI9nQ1b7znYVLlh6ym`, the account default). Live mode needs its
   own: switch plans between the four Starter/Pro prices with proration,
   cancel at period end with a reason, update payment method, invoice history,
   email changes **off** (Stripe's email is not the customer row's key),
   privacy URL `https://intentowl.com/privacy`, return URL
   `https://intentowl.com/dashboard/settings`. The button only appears when
   `STRIPE_SECRET_KEY` is set and the customer came through checkout.
7. **Supabase redirect URLs**: Authentication → URL Configuration → add
   `https://intentowl.com/auth/callback`. Confirmation links point at whatever
   is configured here, and localhost will not work for a customer.

## Railway — the worker

1. New Project → Deploy from GitHub repo → same repo
2. `railway.toml` at the repo root supplies the build, start command and
   health check. Nothing to configure by hand.
3. Environment variables:

   ```
   DATABASE_URL           same Supabase URL
   ANTHROPIC_API_KEY
   RESEND_API_KEY
   DIGEST_FROM            IntentOwl <digests@intentowl.com>
   DIGEST_REPLY_TO        tools@intentowl.com
   APP_URL                https://intentowl.com
   FEEDBACK_SECRET        must match Vercel's exactly
   STACKEXCHANGE_KEY
   BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD
   OPS_SLACK_WEBHOOK_URL  optional; alerts also go by email (below)
   OPS_ALERT_EMAIL        where the watchdog emails problems; defaults to
                          DIGEST_REPLY_TO
   ```

   Railway injects `PORT` itself; do not set it.

4. Watch the deploy log for `health endpoint listening` and
   `schedules synced`. Those two lines mean the queue is registered and the
   crons exist.

**Use port 6543 on Vercel, 5432 on Railway.** Supabase's session pooler (5432)
allows 15 clients total. Every Vercel instance opens its own pool, so the
dashboard fails with `EMAXCONNSESSION: max clients reached in session mode` as
soon as a couple of instances are warm. The transaction pooler (6543) is built
for exactly this: many short-lived serverless connections. The worker stays on
5432, where a single long-lived process is what session mode expects.

### Two things that will bite

**`FEEDBACK_SECRET` must be identical on both.** The worker signs the thumbs
links in the digest; the web app verifies them. A mismatch makes every
feedback link report "that link is not valid", and nothing else breaks, so it
is easy to miss for weeks.

**One worker replica only.** `railway.toml` pins it. The per-source rate
limiters live in process memory, so two instances would each believe they own
the whole request budget and together blow through it.

---

## Still outstanding

- **DMARC.** No `_dmarc.intentowl.com` record exists. Add
  `v=DMARC1; p=none; rua=mailto:tools@intentowl.com` and tighten `p` to
  `quarantine` once Resend has been sending cleanly for a week. Gmail and
  Yahoo treat its absence as a negative signal for bulk senders.
- **Supabase SMTP.** Auth emails still send through Supabase's shared sandbox
  sender: a few per hour, frequently spam-filed. Point it at Resend under
  Project Settings → Authentication → SMTP.
- **Stripe is in test mode.** Live keys need business and bank details.
