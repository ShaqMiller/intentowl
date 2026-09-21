CREATE TABLE "ops_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
