ALTER TABLE "slack_connections" ALTER COLUMN "channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD COLUMN "workspace_name" text;