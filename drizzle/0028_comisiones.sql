-- 068: comisiones del equipo comercial (perfiles versionados, ventas de la
-- plataforma, bitácora de atribución y liquidaciones aprobadas). Aditiva y
-- re-ejecutable: sin la bandera COMISIONES las tablas quedan vacías.
CREATE TABLE IF NOT EXISTS "commission_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"comisiona" boolean DEFAULT false NOT NULL,
	"rate_bps" integer DEFAULT 0 NOT NULL,
	"monthly_base_cents" bigint DEFAULT 0 NOT NULL,
	"referral_code" text,
	"valid_from" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_settlement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"period" text NOT NULL,
	"sales_count" integer NOT NULL,
	"sales_total_cents" bigint NOT NULL,
	"base_cents" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"reached" boolean NOT NULL,
	"adjustment_cents" bigint DEFAULT 0 NOT NULL,
	"commission_cents" bigint NOT NULL,
	"status" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp NOT NULL,
	"paid_by" text,
	"paid_at" timestamp,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"platform_org_id" text NOT NULL,
	"customer_name" text,
	"contact_id" text,
	"lead_id" text,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'COP' NOT NULL,
	"paid_at" timestamp NOT NULL,
	"payment_ref" text NOT NULL,
	"referral_code" text,
	"attributed_user_id" text,
	"attribution_source" text,
	"voided_at" timestamp,
	"void_reason" text,
	"adjustment_period" text,
	"adjustment_cents" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sale_attribution_change" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sale_id" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"reason" text NOT NULL,
	"actor_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_profile" ADD CONSTRAINT "commission_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_profile" ADD CONSTRAINT "commission_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_profile" ADD CONSTRAINT "commission_profile_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_settlement" ADD CONSTRAINT "commission_settlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_settlement" ADD CONSTRAINT "commission_settlement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_settlement" ADD CONSTRAINT "commission_settlement_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "commission_settlement" ADD CONSTRAINT "commission_settlement_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale" ADD CONSTRAINT "sale_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale" ADD CONSTRAINT "sale_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale" ADD CONSTRAINT "sale_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale" ADD CONSTRAINT "sale_attributed_user_id_user_id_fk" FOREIGN KEY ("attributed_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_attribution_change" ADD CONSTRAINT "sale_attribution_change_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_attribution_change" ADD CONSTRAINT "sale_attribution_change_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_attribution_change" ADD CONSTRAINT "sale_attribution_change_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_attribution_change" ADD CONSTRAINT "sale_attribution_change_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "sale_attribution_change" ADD CONSTRAINT "sale_attribution_change_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_profile_org_user_idx" ON "commission_profile" USING btree ("organization_id","user_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "commission_settlement_uq" ON "commission_settlement" USING btree ("organization_id","user_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sale_org_platform_uq" ON "sale" USING btree ("organization_id","platform_org_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sale_org_payment_uq" ON "sale" USING btree ("organization_id","payment_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_org_paid_idx" ON "sale" USING btree ("organization_id","paid_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_org_user_idx" ON "sale" USING btree ("organization_id","attributed_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_attr_change_sale_idx" ON "sale_attribution_change" USING btree ("organization_id","sale_id","created_at");