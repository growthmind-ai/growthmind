CREATE TABLE "slack_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"credential_key_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"health" text DEFAULT 'validating' NOT NULL,
	"health_reason_code" text,
	"health_reason_message" text,
	"health_checked_at" timestamp with time zone,
	"connected_by_user_id" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "first_run_state" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"armed_at" timestamp with time zone,
	"slack_skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "first_run_state_org_project_pk" PRIMARY KEY("organization_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "first_run_dismissals" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"dismissed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "first_run_dismissals_org_user_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "provisioning_key" text;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_run_state" ADD CONSTRAINT "first_run_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_run_state" ADD CONSTRAINT "first_run_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_run_dismissals" ADD CONSTRAINT "first_run_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "first_run_dismissals" ADD CONSTRAINT "first_run_dismissals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_connections_active_org_uidx" ON "slack_connections" USING btree ("organization_id") WHERE "slack_connections"."is_active";--> statement-breakpoint
CREATE INDEX "slack_connections_organization_id_idx" ON "slack_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_provisioning_key_uidx" ON "projects" USING btree ("provisioning_key");