DROP INDEX "divergence_points_identity_key";--> statement-breakpoint
ALTER TABLE "divergence_points" ADD COLUMN "cohort_cut" text DEFAULT 'surface' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "divergence_points_identity_key" ON "divergence_points" USING btree ("organization_id","project_id","surface","cohort_cut","cohort_match_version","window_start","window_end");