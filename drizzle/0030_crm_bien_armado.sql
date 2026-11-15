-- 071: origen deducido, etapas que exigen cita, plantillas ocultas y
-- seguimiento automático. Aditiva y re-ejecutable.
CREATE TABLE IF NOT EXISTS "followup_send" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"step" integer NOT NULL,
	"anchor_at" timestamp NOT NULL,
	"template_id" text,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "source_hint" text;--> statement-breakpoint
ALTER TABLE "pipeline_stage" ADD COLUMN IF NOT EXISTS "requires_booking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN IF NOT EXISTS "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "followup_send" ADD CONSTRAINT "followup_send_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "followup_send" ADD CONSTRAINT "followup_send_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "followup_send_uq" ON "followup_send" USING btree ("conversation_id","step","anchor_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "followup_send_org_idx" ON "followup_send" USING btree ("organization_id","created_at");