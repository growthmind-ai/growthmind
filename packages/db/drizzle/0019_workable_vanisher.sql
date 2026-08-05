CREATE TABLE "recording_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"summary_source" text NOT NULL,
	"headline" text NOT NULL,
	"context" jsonb NOT NULL,
	"transcript" text NOT NULL,
	"pages" jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"action_count" integer NOT NULL,
	"notable_count" integer NOT NULL,
	"dropped_events" integer NOT NULL,
	"started_at" timestamp with time zone,
	"resolved_model_id" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD CONSTRAINT "recording_summaries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD CONSTRAINT "recording_summaries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recording_summaries_project_recording_key" ON "recording_summaries" USING btree ("organization_id","project_id","recording_id");--> statement-breakpoint
CREATE INDEX "recording_summaries_organization_id_idx" ON "recording_summaries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "recording_summaries_org_project_started_at_idx" ON "recording_summaries" USING btree ("organization_id","project_id","started_at");