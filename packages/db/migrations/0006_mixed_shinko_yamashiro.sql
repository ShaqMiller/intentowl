ALTER TYPE "public"."source" ADD VALUE 'threads';--> statement-breakpoint
CREATE TABLE "source_tokens" (
	"source" "source" PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"seed_fingerprint" text NOT NULL,
	"expires_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone NOT NULL
);
