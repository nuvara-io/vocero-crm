-- 077: etapa "demo agendada" reportada a Meta como LeadSubmitted. Aditiva y re-ejecutable.
ALTER TABLE "capi_settings" ADD COLUMN IF NOT EXISTS "demo_stage_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "capi_settings" ADD CONSTRAINT "capi_settings_demo_stage_id_pipeline_stage_id_fk" FOREIGN KEY ("demo_stage_id") REFERENCES "public"."pipeline_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
