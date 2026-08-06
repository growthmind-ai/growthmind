ALTER TABLE "recording_summaries" ADD COLUMN "pull_resume_cursor" text;--> statement-breakpoint
ALTER TABLE "recording_summaries" ADD COLUMN "pull_origin_at" timestamp with time zone;