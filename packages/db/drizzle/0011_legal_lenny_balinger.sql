CREATE TABLE "provider_interest" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"requested_by" text NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_interest" ADD CONSTRAINT "provider_interest_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_interest_org_provider_uidx" ON "provider_interest" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "provider_interest_unnotified_idx" ON "provider_interest" USING btree ("created_at") WHERE "provider_interest"."notified_at" is null;