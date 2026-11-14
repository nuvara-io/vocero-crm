-- 067: asignado del lead (quién hace la demostración o cierra) y días cerrados
-- de la agenda (vacaciones y festivos). Aditiva y re-ejecutable: una instancia
-- sin estos datos sigue exactamente igual.
ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "closed_dates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_settings" ADD COLUMN IF NOT EXISTS "holiday_country" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "assigned_user_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_org_assigned_idx" ON "lead" USING btree ("organization_id","assigned_user_id");
