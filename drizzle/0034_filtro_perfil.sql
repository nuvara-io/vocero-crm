-- 078: filtro de leads fuera de perfil. Aditiva y re-ejecutable.
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "perfil_estado" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "perfil_motivo" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "perfil_revisado_at" timestamp;
