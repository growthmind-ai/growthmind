import { randomUUID } from "node:crypto";

import type { DeliveryLaneDecision } from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const DELIVERY_LANE_DECISIONS = [
  "posted",
  "failed",
  "blocked_by_pii",
  "nothing_today",
  "not_claimed",
  "not_connected",
  "unresolvable",
  "lane_errored",
] as const satisfies readonly [DeliveryLaneDecision, ...DeliveryLaneDecision[]];

// A run, not a tick: one row covers every consecutive tick that reached the same conclusion
// for the same reason, so a row is added only when the answer changes. That bounds the table.
export const deliveryDecisions = pgTable(
  "delivery_decisions",
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

    decision: text("decision", { enum: DELIVERY_LANE_DECISIONS }).notNull(),

    // Plain English, always a constant from @growthmind/shared — never an exception message
    // and never a vendor response body.
    reason: text("reason").notNull(),

    findingId: text("finding_id"),

    channelId: text("channel_id"),

    firstDecidedAt: timestamp("first_decided_at", { withTimezone: true }).notNull(),

    lastDecidedAt: timestamp("last_decided_at", { withTimezone: true }).notNull(),

    // Null while this is the lane's current answer. Set when a tick concludes something else.
    endedAt: timestamp("ended_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The conflict target the extending upsert needs, and the guarantee that a retried tick
    // cannot open a second row for the same answer.
    uniqueIndex("delivery_decisions_open_run_uidx")
      .on(table.organizationId, table.projectId)
      .where(sql`${table.endedAt} is null`),

    index("delivery_decisions_organization_id_idx").on(table.organizationId),

    index("delivery_decisions_org_project_started_idx").on(
      table.organizationId,
      table.projectId,
      table.firstDecidedAt,
    ),
  ],
);
