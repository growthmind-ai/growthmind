CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"signature" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"message_ref" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_org_finding_channel_key" ON "deliveries" USING btree ("organization_id","finding_id","channel_id");--> statement-breakpoint
CREATE INDEX "deliveries_organization_id_idx" ON "deliveries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deliveries_org_project_status_idx" ON "deliveries" USING btree ("organization_id","project_id","status");--> statement-breakpoint
CREATE INDEX "deliveries_org_signature_idx" ON "deliveries" USING btree ("organization_id","signature");