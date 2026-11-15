-- 071: Better Auth 1.7 exige invitation.created_at. Aditiva y re-ejecutable.
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;