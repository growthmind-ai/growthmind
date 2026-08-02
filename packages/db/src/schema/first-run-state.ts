import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

export const firstRunState = pgTable(
  "first_run_state",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    armedAt: timestamp("armed_at", { withTimezone: true }),

    slackSkippedAt: timestamp("slack_skipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "first_run_state_org_project_pk",
      columns: [table.organizationId, table.projectId],
    }),
  ],
);
