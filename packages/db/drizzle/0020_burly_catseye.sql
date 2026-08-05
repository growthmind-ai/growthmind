ALTER TABLE "api_keys" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "write_keys" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "project_connections" ADD COLUMN "connected_by_user_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_keys" ADD CONSTRAINT "write_keys_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_connections" ADD CONSTRAINT "project_connections_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;