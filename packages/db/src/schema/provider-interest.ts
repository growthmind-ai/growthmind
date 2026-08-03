import { randomUUID } from "node:crypto";

import { INTEREST_PROVIDER_IDS } from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";

export const providerInterest = pgTable(
  "provider_interest",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: INTEREST_PROVIDER_IDS }).notNull(),

    // Audit only, no user FK: the demand is the org's, and deleting the author's
    // user row must not erase it (AD-3).
    requestedBy: text("requested_by").notNull(),

    // Null until the internal post is claimed; the stamp IS the claim (AD-2).
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("provider_interest_org_provider_uidx").on(table.organizationId, table.provider),
    index("provider_interest_unnotified_idx")
      .on(table.createdAt)
      .where(sql`${table.notifiedAt} is null`),
  ],
);
