CREATE TYPE "public"."customer_status" AS ENUM('lead', 'active', 'churned');--> statement-breakpoint
CREATE TYPE "public"."digest_channel" AS ENUM('email', 'slack');--> statement-breakpoint
CREATE TYPE "public"."feedback_verdict" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."intent" AS ENUM('buying_intent', 'pain_point', 'competitor_complaint', 'question', 'none');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('reddit', 'hn', 'bluesky', 'rss', 'x');--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"source" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"day" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"watch_id" uuid NOT NULL,
	"relevant" boolean NOT NULL,
	"intent" "intent" NOT NULL,
	"score" integer NOT NULL,
	"reason" text,
	"reply_angle" text,
	"model" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cursors" (
	"watch_id" uuid NOT NULL,
	"source" "source" NOT NULL,
	"cursor" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cursors_watch_id_source_pk" PRIMARY KEY("watch_id","source")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"status" "customer_status" DEFAULT 'lead' NOT NULL,
	"stripe_customer_id" text,
	"plan" text,
	"tz" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_items" (
	"digest_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "digest_items_digest_id_item_id_pk" PRIMARY KEY("digest_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "digest_channel" NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"verdict" "feedback_verdict" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_watches" (
	"item_id" uuid NOT NULL,
	"watch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_watches_item_id_watch_id_pk" PRIMARY KEY("item_id","watch_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source" NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"author" text,
	"title" text,
	"body" text,
	"venue" text,
	"posted_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"engagement" jsonb
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"customer_id" uuid PRIMARY KEY NOT NULL,
	"product_desc" text,
	"icp_desc" text,
	"competitors" text[] DEFAULT '{}' NOT NULL,
	"disqualifiers" text[] DEFAULT '{}' NOT NULL,
	"few_shot_examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sources" "source"[] DEFAULT '{}' NOT NULL,
	"subreddits" text[] DEFAULT '{}' NOT NULL,
	"include_terms" text[] DEFAULT '{}' NOT NULL,
	"exclude_terms" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cursors" ADD CONSTRAINT "cursors_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_items" ADD CONSTRAINT "digest_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_watches" ADD CONSTRAINT "item_watches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_watches" ADD CONSTRAINT "item_watches_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_customer_source_day_key" ON "api_usage" USING btree ("customer_id","source","day");--> statement-breakpoint
CREATE INDEX "api_usage_day_idx" ON "api_usage" USING btree ("day");--> statement-breakpoint
CREATE UNIQUE INDEX "classifications_item_watch_model_key" ON "classifications" USING btree ("item_id","watch_id","model");--> statement-breakpoint
CREATE INDEX "classifications_watch_id_idx" ON "classifications" USING btree ("watch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_email_key" ON "customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_stripe_customer_id_key" ON "customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "digests_customer_id_sent_at_idx" ON "digests" USING btree ("customer_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_customer_item_key" ON "feedback" USING btree ("customer_id","item_id");--> statement-breakpoint
CREATE INDEX "item_watches_watch_id_idx" ON "item_watches" USING btree ("watch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_source_external_id_key" ON "items" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "items_posted_at_idx" ON "items" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "watches_customer_id_idx" ON "watches" USING btree ("customer_id");