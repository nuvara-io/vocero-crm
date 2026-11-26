CREATE TABLE "scheduled_send" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"template_id" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"send_at" timestamp NOT NULL,
	"status" text DEFAULT 'pendiente' NOT NULL,
	"error" text,
	"created_by_user_id" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_send" ADD CONSTRAINT "scheduled_send_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_send" ADD CONSTRAINT "scheduled_send_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_send" ADD CONSTRAINT "scheduled_send_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_send" ADD CONSTRAINT "scheduled_send_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_send_due_idx" ON "scheduled_send" USING btree ("status","send_at");--> statement-breakpoint
CREATE INDEX "scheduled_send_org_idx" ON "scheduled_send" USING btree ("organization_id","send_at");