-- 069: comisiones sobre el neto (IVA configurable) y ventas registradas a mano
-- por otro WhatsApp u otro canal. Aditiva y re-ejecutable.
CREATE TABLE IF NOT EXISTS "commission_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"iva_bps" integer DEFAULT 1900 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commission_settlement" ADD COLUMN IF NOT EXISTS "iva_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_settlement" ADD COLUMN IF NOT EXISTS "sales_net_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'plataforma' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "channel" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'confirmada' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "customer_email" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN IF NOT EXISTS "review_note" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale" ADD CONSTRAINT "sale_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale" ADD CONSTRAINT "sale_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_org_status_idx" ON "sale" USING btree ("organization_id","status");