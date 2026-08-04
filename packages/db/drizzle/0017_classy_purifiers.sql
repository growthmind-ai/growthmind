ALTER TABLE "growth_context" ADD COLUMN "site_domain" text;--> statement-breakpoint
ALTER TABLE "growth_context" ADD COLUMN "icp" jsonb DEFAULT '{"beliefs":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_context" ADD COLUMN "research_status" text DEFAULT 'never_run' NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_context" ADD COLUMN "researched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "growth_context" ADD COLUMN "research_failure" text;