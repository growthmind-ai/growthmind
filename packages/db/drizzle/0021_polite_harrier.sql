ALTER TABLE "recording_summaries" ADD COLUMN "provider" text DEFAULT 'posthog' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "session_key" text;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "session_grouping_version" integer;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "actions" jsonb;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "actions_version" integer;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "actions_omitted" integer;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "pull_stop" text;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "pull_reason" text;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "pull_watermark_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "bytes_received" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "recording_summaries_org_project_session_key_uidx" ON "recording_summaries" USING btree ("organization_id","project_id","session_key") WHERE "recording_summaries"."session_key" is not null;