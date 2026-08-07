ALTER TABLE "sessions" ADD COLUMN "recording_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "recording_active_seconds" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "recording_click_count" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "recording_keypress_count" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "recording_console_error_count" integer;