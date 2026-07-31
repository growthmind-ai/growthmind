CREATE TABLE "analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"outcome" text,
	"stop_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"model_calls_attempted" integer DEFAULT 0 NOT NULL,
	"candidates_unrenderable" integer DEFAULT 0 NOT NULL,
	"candidates_refused" integer DEFAULT 0 NOT NULL,
	"resolved_model_id" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"signature" text NOT NULL,
	"signature_version" integer NOT NULL,
	"summary_source" text NOT NULL,
	"headline" text NOT NULL,
	"context" jsonb NOT NULL,
	"final_class" text NOT NULL,
	"surface" text NOT NULL,
	"surface_role" text DEFAULT 'surface' NOT NULL,
	"surface_normalisation_version" integer,
	"counts" jsonb NOT NULL,
	"confidence_basis" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"evidence_shape" text NOT NULL,
	"evidence_shape_version" integer NOT NULL,
	"resolved_model_id" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"run_id" text NOT NULL,
	"signature" text NOT NULL,
	"signature_version" integer NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD CONSTRAINT "analysis_model_calls_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD CONSTRAINT "analysis_model_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_calls" ADD CONSTRAINT "analysis_model_calls_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_one_open_per_project_key" ON "analysis_runs" USING btree ("organization_id","project_id") WHERE "analysis_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "analysis_runs_organization_id_idx" ON "analysis_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "analysis_runs_org_project_started_at_idx" ON "analysis_runs" USING btree ("organization_id","project_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_org_project_signature_key" ON "findings" USING btree ("organization_id","project_id","signature");--> statement-breakpoint
CREATE INDEX "findings_organization_id_idx" ON "findings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "findings_org_project_created_at_idx" ON "findings" USING btree ("organization_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "findings_org_run_id_idx" ON "findings" USING btree ("organization_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_model_calls_org_project_signature_key" ON "analysis_model_calls" USING btree ("organization_id","project_id","signature");--> statement-breakpoint
CREATE INDEX "analysis_model_calls_organization_id_idx" ON "analysis_model_calls" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "analysis_model_calls_org_project_idx" ON "analysis_model_calls" USING btree ("organization_id","project_id");