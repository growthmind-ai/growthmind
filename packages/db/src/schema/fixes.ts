import { randomUUID } from "node:crypto";

import type { FixStatus } from "@growthmind/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { findings } from "./findings";
import { projects } from "./projects";

const FIX_STATUSES = [
  "open",
  "awaiting_verification",
  "verified",
  "withdrawn",
] as const satisfies readonly [FixStatus, ...FixStatus[]];

export const fixes = pgTable(
  "fixes",
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

    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),

    status: text("status", { enum: FIX_STATUSES }).notNull().default("open"),

    attempt: integer("attempt").notNull().default(1),

    alreadyLanded: jsonb("already_landed").$type<readonly string[]>().notNull().default([]),

    resultsBy: timestamp("results_by", { withTimezone: true }).notNull(),
    resultsByRuleVersion: integer("results_by_rule_version").notNull(),

    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),

    // No foreign key: the actor may be an api key or a Slack interaction, neither of
    // which is a `user` row. Precedent: `deliveries.finding_id`.
    openedBy: text("opened_by").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("fixes_org_finding_key").on(table.organizationId, table.findingId),

    index("fixes_organization_id_idx").on(table.organizationId),

    index("fixes_org_status_results_by_idx").on(
      table.organizationId,
      table.status,
      table.resultsBy,
    ),
  ],
);
