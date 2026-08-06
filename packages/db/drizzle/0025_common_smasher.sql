CREATE TABLE "cause_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"anchor_session_id" text NOT NULL,
	"claims" jsonb NOT NULL,
	"dropped_claims" integer NOT NULL,
	"resolved_model_id" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "analysis_model_calls_org_project_signature_key";--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD COLUMN "stage" text DEFAULT 'render' NOT NULL;--> statement-breakpoint
ALTER TABLE "cause_claims" ADD CONSTRAINT "cause_claims_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cause_claims" ADD CONSTRAINT "cause_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cause_claims" ADD CONSTRAINT "cause_claims_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cause_claims_org_project_finding_key" ON "cause_claims" USING btree ("organization_id","project_id","finding_id");--> statement-breakpoint
CREATE INDEX "cause_claims_organization_id_idx" ON "cause_claims" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_model_calls_org_project_signature_stage_key" ON "analysis_model_calls" USING btree ("organization_id","project_id","signature","stage");