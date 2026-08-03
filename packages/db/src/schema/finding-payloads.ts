import { randomUUID } from "node:crypto";

import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { findings } from "./findings";

// A sibling of `findings`, not a column on it: the delivery lane reads 50 finding rows a
// tick through a bare `select()`, and a TOASTed payload would ride along on every one. No
// `project_id`: the scoped read narrows by `organization_id` alone.
export const findingPayloads = pgTable(
  "finding_payloads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),

    payloadVersion: integer("payload_version").notNull(),

    candidate: jsonb("candidate").notNull(),

    signals: jsonb("signals").$type<readonly unknown[]>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("finding_payloads_org_finding_key").on(table.organizationId, table.findingId),

    index("finding_payloads_organization_id_idx").on(table.organizationId),
  ],
);
