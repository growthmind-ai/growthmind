import { randomUUID } from "node:crypto";

import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    provisioningKey: text("provisioning_key"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("projects_organization_id_idx").on(table.organizationId),

    uniqueIndex("projects_provisioning_key_uidx").on(table.provisioningKey),
  ],
);
