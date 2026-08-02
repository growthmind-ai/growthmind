import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";

export const firstRunDismissals = pgTable(
  "first_run_dismissals",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "first_run_dismissals_org_user_pk",
      columns: [table.organizationId, table.userId],
    }),
  ],
);
