/**
 * IntentOwl database schema - the single source of truth.
 *
 * Mirrors ARCHITECTURE.md section 6. Change the schema here and only here, then
 * run `pnpm db:generate` + `pnpm db:migrate`. Never hand-edit generated
 * migrations and never issue schema DDL from application code.
 *
 * pg-boss owns its own `pgboss` schema and is not modelled here.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// --- enums ------------------------------------------------------------------

export const customerStatus = pgEnum("customer_status", [
  "lead",
  "active",
  "churned",
]);

export const source = pgEnum("source", [
  "reddit",
  "hn",
  "lobsters",
  "stackexchange",
  "bluesky",
  "rss",
  "x",
]);

export const intent = pgEnum("intent", [
  "buying_intent",
  "pain_point",
  "competitor_complaint",
  "question",
  "none",
]);

export const digestChannel = pgEnum("digest_channel", ["email", "slack"]);

export const feedbackVerdict = pgEnum("feedback_verdict", ["up", "down"]);

// --- tenancy ----------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    status: customerStatus("status").notNull().default("lead"),
    stripeCustomerId: text("stripe_customer_id"),
    plan: text("plan"),
    /**
     * Supabase Auth user id, set when the customer first claims their login.
     * Null for anyone onboarded by hand who has never signed in.
     *
     * Deliberately not the primary key and deliberately not email: payment
     * creates the customer row before any auth user exists, and an auth email
     * change must not orphan the row it points at.
     */
    authUserId: uuid("auth_user_id"),
    /** IANA timezone, e.g. "Europe/London". Digest send hour is local to this. */
    tz: text("tz").notNull().default("UTC"),
    /**
     * Local hour to send the digest, 0-23. Stored as the hour the customer
     * asked for, never as a precomputed UTC hour: the offset between the two
     * moves twice a year, on different dates in different countries.
     */
    digestHour: integer("digest_hour").notNull().default(7),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_email_key").on(t.email),
    uniqueIndex("customers_stripe_customer_id_key").on(t.stripeCustomerId),
    // One auth user maps to at most one customer.
    uniqueIndex("customers_auth_user_id_key").on(t.authUserId),
  ],
);

/** The per-customer context block injected into the classification prompt. */
export const profiles = pgTable("profiles", {
  customerId: uuid("customer_id")
    .primaryKey()
    .references(() => customers.id, { onDelete: "cascade" }),
  productDesc: text("product_desc"),
  icpDesc: text("icp_desc"),
  competitors: text("competitors").array().notNull().default([]),
  disqualifiers: text("disqualifiers").array().notNull().default([]),
  /** Few-shot examples harvested from this customer's own feedback. */
  fewShotExamples: jsonb("few_shot_examples").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watches = pgTable(
  "watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sources: source("sources").array().notNull().default([]),
    subreddits: text("subreddits").array().notNull().default([]),
    includeTerms: text("include_terms").array().notNull().default([]),
    excludeTerms: text("exclude_terms").array().notNull().default([]),
    /**
     * Per-source settings that do not deserve a column each: which Stack
     * Exchange sites, which RSS feed URLs, which Lobsters tags. Keyed by
     * source name. `subreddits` predates this and stays where it is.
     */
    sourceConfig: jsonb("source_config"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("watches_customer_id_idx").on(t.customerId),
    // A natural key so re-onboarding a customer updates their watches in place.
    // Without it, a seed file has to delete and recreate them, and the cascade
    // takes item_watches and classifications with it -- silently destroying the
    // lead history you already paid to classify.
    uniqueIndex("watches_customer_name_key").on(t.customerId, t.name),
  ],
);

/** Last-seen position per (watch, source). Makes polling incremental. */
export const cursors = pgTable(
  "cursors",
  {
    watchId: uuid("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    source: source("source").notNull(),
    cursor: jsonb("cursor"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.watchId, t.source] })],
);

// --- pipeline ---------------------------------------------------------------

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: source("source").notNull(),
    /** Platform-native id, e.g. a Reddit fullname `t3_abc123`. */
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    title: text("title"),
    body: text("body"),
    /** Sub-source the item came from, e.g. "r/SaaS" or an RSS feed title. */
    venue: text("venue"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    engagement: jsonb("engagement"),
  },
  (t) => [
    // The idempotency anchor for ingestion: re-polls upsert, never duplicate.
    uniqueIndex("items_source_external_id_key").on(t.source, t.externalId),
    index("items_posted_at_idx").on(t.postedAt),
  ],
);

/** An item can match several watches; classification is per (item, watch). */
export const itemWatches = pgTable(
  "item_watches",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    watchId: uuid("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Set when the pre-filter rejected this pair, so it is *decided* rather
     * than merely unclassified.
     *
     * Without this the classify job starves: it selects pairs with no
     * classification row, a filtered pair never gets one, so the same rejects
     * are re-selected every run until they fill the per-run limit and no new
     * item is ever classified again — silently, while the logs report success.
     */
    filteredAt: timestamp("filtered_at", { withTimezone: true }),
    /** Which rule rejected it, for debugging a customer's watch. */
    filterReason: text("filter_reason"),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.watchId] }),
    index("item_watches_watch_id_idx").on(t.watchId),
    // The classify job's hot path: undecided pairs for a watch.
    index("item_watches_pending_idx").on(t.watchId, t.filteredAt),
  ],
);

export const classifications = pgTable(
  "classifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    watchId: uuid("watch_id")
      .notNull()
      .references(() => watches.id, { onDelete: "cascade" }),
    relevant: boolean("relevant").notNull(),
    intent: intent("intent").notNull(),
    /** 0-100, as returned by the model. */
    score: integer("score").notNull(),
    reason: text("reason"),
    replyAngle: text("reply_angle"),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per model per (item, watch), so the Haiku -> Sonnet escalation
    // keeps both verdicts while retries stay idempotent upserts.
    uniqueIndex("classifications_item_watch_model_key").on(
      t.itemId,
      t.watchId,
      t.model,
    ),
    index("classifications_watch_id_idx").on(t.watchId),
  ],
);

// --- delivery ---------------------------------------------------------------

export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    channel: digestChannel("channel").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    /** True when a source or the classifier was down; the digest still sent. */
    degraded: boolean("degraded").notNull().default(false),
  },
  (t) => [index("digests_customer_id_sent_at_idx").on(t.customerId, t.sentAt)],
);

export const digestItems = pgTable(
  "digest_items",
  {
    digestId: uuid("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.digestId, t.itemId] })],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    verdict: feedbackVerdict("verdict").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Latest verdict wins; a re-clicked feedback link must not stack rows.
    uniqueIndex("feedback_customer_item_key").on(t.customerId, t.itemId),
  ],
);

// --- telemetry --------------------------------------------------------------

/** Per-customer unit economics. Every external API and LLM call lands here. */
export const apiUsage = pgTable(
  "api_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for shared/system calls not attributable to one customer. */
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    source: text("source").notNull(),
    calls: integer("calls").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
      .notNull()
      .default("0"),
    day: date("day").notNull(),
  },
  (t) => [
    // Usage accumulates per (customer, source, day) so a retried job
    // increments an existing row instead of fanning out new ones.
    uniqueIndex("api_usage_customer_source_day_key").on(
      t.customerId,
      t.source,
      t.day,
    ),
    index("api_usage_day_idx").on(t.day),
  ],
);
