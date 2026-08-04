import { randomUUID } from "node:crypto";

import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

export const growthContext = pgTable(
  "growth_context",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    surfaces: jsonb("surfaces").notNull().default([]),

    confirmedChangeable: jsonb("confirmed_changeable").notNull().default([]),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("growth_context_org_project_key").on(table.organizationId, table.projectId),

    index("growth_context_organization_id_idx").on(table.organizationId),
  ],
);
