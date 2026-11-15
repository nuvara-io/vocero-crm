-- 072: prospección (permiso, supresión, lista de origen). Aditiva y re-ejecutable.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "prospect_list" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "permission_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "consent_channel" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "consent_text" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "consent_by" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "first_contact_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "do_not_contact_at" timestamp;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "do_not_contact_reason" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contact" ADD CONSTRAINT "contact_consent_by_user_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_prospect_idx" ON "contact" USING btree ("organization_id","prospect_list");