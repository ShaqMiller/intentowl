ALTER TABLE "customers" ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_auth_user_id_key" ON "customers" USING btree ("auth_user_id");