CREATE TABLE "finding_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"signature" text NOT NULL,
	"symptom_class" text NOT NULL,
	"surface" text NOT NULL,
	"signature_tuple_version" integer NOT NULL,
	"evidence_shape_version" integer NOT NULL,
	"surface_normalisation_version" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"signature" text NOT NULL,
	"action" text NOT NULL,
	"dismissed_by_user_id" text,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_ancestry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"old_signature" text NOT NULL,
	"new_signature" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_signatures" ADD CONSTRAINT "finding_signatures_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_signatures" ADD CONSTRAINT "finding_signatures_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissals" ADD CONSTRAINT "dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissals" ADD CONSTRAINT "dismissals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissals" ADD CONSTRAINT "dismissals_dismissed_by_user_id_user_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_ancestry" ADD CONSTRAINT "signature_ancestry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_ancestry" ADD CONSTRAINT "signature_ancestry_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_signatures_org_project_signature_key" ON "finding_signatures" USING btree ("organization_id","project_id","signature");--> statement-breakpoint
CREATE INDEX "finding_signatures_organization_id_idx" ON "finding_signatures" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dismissals_org_finding_action_key" ON "dismissals" USING btree ("organization_id","finding_id","action");--> statement-breakpoint
CREATE INDEX "dismissals_organization_id_idx" ON "dismissals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "dismissals_org_signature_idx" ON "dismissals" USING btree ("organization_id","signature");--> statement-breakpoint
CREATE UNIQUE INDEX "signature_ancestry_org_old_signature_key" ON "signature_ancestry" USING btree ("organization_id","old_signature");--> statement-breakpoint
CREATE INDEX "signature_ancestry_organization_id_idx" ON "signature_ancestry" USING btree ("organization_id");