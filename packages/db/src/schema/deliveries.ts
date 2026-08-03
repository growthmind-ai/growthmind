import { randomUUID } from "node:crypto";

import type { DeliveryStatus } from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const DELIVERY_STATUSES = ["pending", "posted", "failed"] as const satisfies readonly [
  DeliveryStatus,
  ...DeliveryStatus[],
];

export const deliveries = pgTable(
  "deliveries",
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

    channelId: text("channel_id").notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),

    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),

    postedAt: timestamp("posted_at", { withTimezone: true }),

    failedAt: timestamp("failed_at", { withTimezone: true }),

    failureReason: text("failure_reason"),

    messageRef: text("message_ref"),

    attempts: integer("attempts").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("deliveries_org_finding_channel_key").on(
      table.organizationId,
      table.findingId,
      table.channelId,
    ),

    index("deliveries_organization_id_idx").on(table.organizationId),

    index("deliveries_org_project_status_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
    ),

    index("deliveries_org_signature_idx").on(table.organizationId, table.signature),

    // Globally unique, not org-scoped: a Slack (channel, message) pair is the only key an
    // interactivity payload carries, and it must resolve to exactly one organization.
    // Partial, because a delivery claimed but never posted still has a null message_ref.
    uniqueIndex("deliveries_channel_message_uidx")
      .on(table.channelId, table.messageRef)
      .where(sql`${table.messageRef} is not null`),
  ],
);
