import { randomUUID } from "node:crypto";

import { SHIPPED_VERDICTS } from "@growthmind/shared";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { shippedChanges } from "./shipped-changes";

// The founder's answer, and its absence when the window lapses. One row per change: the
// write-back is the judgement itself, so a second press must never overwrite the first.
export const shippedChangeVerdicts = pgTable(
  "shipped_change_verdicts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    changeId: text("change_id")
      .notNull()
      .references(() => shippedChanges.id, { onDelete: "cascade" }),

    verdict: text("verdict", { enum: SHIPPED_VERDICTS }).notNull(),

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),

    // Attribution only, never a filter, after slack_connections.connected_by_user_id.
    recordedBySlackUserId: text("recorded_by_slack_user_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("shipped_change_verdicts_change_uidx").on(table.organizationId, table.changeId),
  ],
);
