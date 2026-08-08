CREATE TABLE "notification_mutes" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"class" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_mutes_organization_id_user_id_class_pk" PRIMARY KEY("organization_id","user_id","class"),
	CONSTRAINT "notification_mutes_class_check" CHECK ("notification_mutes"."class" in ('work', 'record'))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"digest_cadence" text DEFAULT 'weekly' NOT NULL,
	"digest_day" text DEFAULT 'monday' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_sends" ADD COLUMN "channel_label" text;--> statement-breakpoint
ALTER TABLE "notification_sends" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_mutes" ADD CONSTRAINT "notification_mutes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_mutes_org_user_idx" ON "notification_mutes" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "notifications_org_type_subject_created_at_idx" ON "notifications" USING btree ("organization_id","type","subject_id","created_at");