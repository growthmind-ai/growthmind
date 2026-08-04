CREATE TABLE "finding_payloads" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"payload_version" integer NOT NULL,
	"candidate" jsonb NOT NULL,
	"signals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fixes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"already_landed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results_by" timestamp with time zone NOT NULL,
	"results_by_rule_version" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_payloads" ADD CONSTRAINT "finding_payloads_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_payloads" ADD CONSTRAINT "finding_payloads_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixes" ADD CONSTRAINT "fixes_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_payloads_org_finding_key" ON "finding_payloads" USING btree ("organization_id","finding_id");--> statement-breakpoint
CREATE INDEX "finding_payloads_organization_id_idx" ON "finding_payloads" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fixes_org_finding_key" ON "fixes" USING btree ("organization_id","finding_id");--> statement-breakpoint
CREATE INDEX "fixes_organization_id_idx" ON "fixes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fixes_org_status_results_by_idx" ON "fixes" USING btree ("organization_id","status","results_by");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_channel_message_uidx" ON "deliveries" USING btree ("channel_id","message_ref") WHERE "deliveries"."message_ref" is not null;