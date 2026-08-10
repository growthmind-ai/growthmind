CREATE TABLE "shipped_change_verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"change_id" text NOT NULL,
	"verdict" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"recorded_by_slack_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipped_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"page" text NOT NULL,
	"page_normalisation_version" integer NOT NULL,
	"control_label" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"corpus_kind" text NOT NULL,
	"readout_due_at" timestamp with time zone NOT NULL,
	"lead_count" text DEFAULT 'reach' NOT NULL,
	"state" text DEFAULT 'reported' NOT NULL,
	"abandoned_reason" text,
	"reported_at" timestamp with time zone NOT NULL,
	"read_out_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "verdict_window_days" integer;--> statement-breakpoint
ALTER TABLE "shipped_change_verdicts" ADD CONSTRAINT "shipped_change_verdicts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipped_change_verdicts" ADD CONSTRAINT "shipped_change_verdicts_change_id_shipped_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."shipped_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipped_changes" ADD CONSTRAINT "shipped_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipped_changes" ADD CONSTRAINT "shipped_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipped_change_verdicts_change_uidx" ON "shipped_change_verdicts" USING btree ("organization_id","change_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipped_changes_change_key_uidx" ON "shipped_changes" USING btree ("organization_id","project_id","page","control_label");--> statement-breakpoint
CREATE INDEX "shipped_changes_organization_id_idx" ON "shipped_changes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shipped_changes_org_state_readout_due_at_idx" ON "shipped_changes" USING btree ("organization_id","state","readout_due_at");--> statement-breakpoint
CREATE INDEX "shipped_changes_org_state_read_out_at_idx" ON "shipped_changes" USING btree ("organization_id","state","read_out_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_sends_channel_message_uidx" ON "notification_sends" USING btree ("target","message_ref") WHERE "notification_sends"."message_ref" is not null;