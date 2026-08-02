import { randomUUID } from "node:crypto";

import type { DismissalAction } from "@growthmind/shared";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization, user } from "./auth";
import { projects } from "./projects";

const DISMISSAL_ACTIONS = ["not_useful"] as const satisfies readonly [
  DismissalAction,
  ...DismissalAction[],
];

export const dismissals = pgTable(
  "dismissals",
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

    findingId: text("finding_id").notNull(),

    signature: text("signature").notNull(),
    action: text("action", { enum: DISMISSAL_ACTIONS }).notNull(),

    dismissedByUserId: text("dismissed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("dismissals_org_finding_action_key").on(
      table.organizationId,
      table.findingId,
      table.action,
    ),
    index("dismissals_organization_id_idx").on(table.organizationId),
    index("dismissals_org_signature_idx").on(table.organizationId, table.signature),
  ],
);
