CREATE TABLE "delivery_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"finding_id" text,
	"channel_id" text,
	"first_decided_at" timestamp with time zone NOT NULL,
	"last_decided_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "rendered_message" jsonb;--> statement-breakpoint
ALTER TABLE "delivery_decisions" ADD CONSTRAINT "delivery_decisions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_decisions" ADD CONSTRAINT "delivery_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_decisions_open_run_uidx" ON "delivery_decisions" USING btree ("organization_id","project_id") WHERE "delivery_decisions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "delivery_decisions_organization_id_idx" ON "delivery_decisions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "delivery_decisions_org_project_started_idx" ON "delivery_decisions" USING btree ("organization_id","project_id","first_decided_at");