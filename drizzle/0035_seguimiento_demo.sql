ALTER TABLE "booking" ADD COLUMN "next_step" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "next_step_on" text;--> statement-breakpoint
ALTER TABLE "booking" ADD COLUMN "next_step_done_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation_note" ADD COLUMN "booking_id" text;--> statement-breakpoint
ALTER TABLE "conversation_note" ADD CONSTRAINT "conversation_note_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_note_booking_idx" ON "conversation_note" USING btree ("booking_id");