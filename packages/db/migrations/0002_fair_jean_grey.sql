ALTER TYPE "public"."source" ADD VALUE 'lobsters' BEFORE 'bluesky';--> statement-breakpoint
ALTER TYPE "public"."source" ADD VALUE 'stackexchange' BEFORE 'bluesky';--> statement-breakpoint
ALTER TABLE "watches" ADD COLUMN "source_config" jsonb;