CREATE TABLE "growth_context" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"surfaces" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_changeable" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "growth_context" ADD CONSTRAINT "growth_context_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_context" ADD CONSTRAINT "growth_context_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_context_org_project_key" ON "growth_context" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "growth_context_organization_id_idx" ON "growth_context" USING btree ("organization_id");