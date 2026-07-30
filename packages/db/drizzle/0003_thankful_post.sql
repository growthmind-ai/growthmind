CREATE TABLE "project_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"host" text NOT NULL,
	"source_project_id" text NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"credential_key_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"health" text NOT NULL,
	"health_reason_code" text,
	"health_reason_message" text,
	"health_checked_at" timestamp with time zone,
	"watermark_at" timestamp with time zone,
	"backfill_before" text,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"poll_interval_seconds" integer DEFAULT 60 NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inferred_internal_domain" text,
	"internal_domain_provenance" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"session_key" text NOT NULL,
	"identity_key" text,
	"identity_email_domain" text,
	"identity_resolution" text NOT NULL,
	"user_agent" text,
	"entry_url_path" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"exclusion_reason" text NOT NULL,
	"internal_domain_at_stamp" text,
	"exclusion_rule_set_version" integer NOT NULL,
	"grouping_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"session_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"url_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_source_poll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"outcome" text,
	"failure_code" text,
	"failure_message" text,
	"events_received" integer DEFAULT 0 NOT NULL,
	"events_persisted" integer DEFAULT 0 NOT NULL,
	"events_dropped_malformed" integer DEFAULT 0 NOT NULL,
	"sessions_touched" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"identity_lookups_used" integer DEFAULT 0 NOT NULL,
	"watermark_advanced_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_connections" ADD CONSTRAINT "project_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_connections" ADD CONSTRAINT "project_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_connection_id_project_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."project_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_connection_id_project_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."project_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_source_poll_runs" ADD CONSTRAINT "session_source_poll_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_source_poll_runs" ADD CONSTRAINT "session_source_poll_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_source_poll_runs" ADD CONSTRAINT "session_source_poll_runs_connection_id_project_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."project_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_connections_active_project_uidx" ON "project_connections" USING btree ("project_id") WHERE "project_connections"."is_active";--> statement-breakpoint
CREATE INDEX "project_connections_organization_id_idx" ON "project_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_connections_next_poll_at_idx" ON "project_connections" USING btree ("next_poll_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_project_session_key_uidx" ON "sessions" USING btree ("project_id","session_key");--> statement-breakpoint
CREATE INDEX "sessions_organization_id_idx" ON "sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sessions_project_started_at_idx" ON "sessions" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_connection_id_idx" ON "sessions" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_project_source_event_id_uidx" ON "events" USING btree ("project_id","source_event_id");--> statement-breakpoint
CREATE INDEX "events_organization_id_idx" ON "events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "events_project_occurred_at_idx" ON "events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_session_id_idx" ON "events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_source_poll_runs_organization_id_idx" ON "session_source_poll_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "session_source_poll_runs_connection_finished_at_idx" ON "session_source_poll_runs" USING btree ("connection_id","finished_at");