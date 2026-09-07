ALTER TABLE "item_watches" ADD COLUMN "filtered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_watches" ADD COLUMN "filter_reason" text;--> statement-breakpoint
CREATE INDEX "item_watches_pending_idx" ON "item_watches" USING btree ("watch_id","filtered_at");