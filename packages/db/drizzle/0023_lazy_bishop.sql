CREATE TABLE "divergence_points" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"surface" text NOT NULL,
	"surface_normalisation_version" integer,
	"spine_version" integer NOT NULL,
	"cohort_match_version" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"diverged_at_rank" integer,
	"reason" text,
	"succeeded_cohort_size" integer NOT NULL,
	"failed_cohort_size" integer NOT NULL,
	"succeeded_session_ids_sample" jsonb NOT NULL,
	"failed_session_ids_sample" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "divergence_points" ADD CONSTRAINT "divergence_points_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergence_points" ADD CONSTRAINT "divergence_points_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "divergence_points_identity_key" ON "divergence_points" USING btree ("organization_id","project_id","surface","cohort_match_version","window_start","window_end");--> statement-breakpoint
CREATE INDEX "divergence_points_organization_id_idx" ON "divergence_points" USING btree ("organization_id");