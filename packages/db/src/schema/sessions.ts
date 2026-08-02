import { randomUUID } from "node:crypto";

import type { ExclusionReason, IdentityResolution, Origin } from "@growthmind/shared";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectConnections } from "./project-connections";
import { projects } from "./projects";

const IDENTITY_RESOLUTIONS = ["resolved", "absent", "unresolved"] as const satisfies readonly [
  IdentityResolution,
  ...IdentityResolution[],
];

const ORIGINS = ["real", "synthetic"] as const satisfies readonly [Origin, ...Origin[]];

const EXCLUSION_REASONS = [
  "none",
  "internal_domain",
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
] as const satisfies readonly [ExclusionReason, ...ExclusionReason[]];

export const sessions = pgTable(
  "sessions",
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
    connectionId: text("connection_id")
      .notNull()
      .references(() => projectConnections.id, { onDelete: "cascade" }),

    sessionKey: text("session_key").notNull(),

    identityKey: text("identity_key"),

    identityEmailDomain: text("identity_email_domain"),

    identityResolution: text("identity_resolution", { enum: IDENTITY_RESOLUTIONS }).notNull(),

    userAgent: text("user_agent"),
    entryUrlPath: text("entry_url_path"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),

    origin: text("origin", { enum: ORIGINS }).notNull(),

    exclusionReason: text("exclusion_reason", { enum: EXCLUSION_REASONS }).notNull(),

    internalDomainAtStamp: text("internal_domain_at_stamp"),
    exclusionRuleSetVersion: integer("exclusion_rule_set_version").notNull(),
    groupingVersion: integer("grouping_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("sessions_project_session_key_uidx").on(table.projectId, table.sessionKey),
    index("sessions_organization_id_idx").on(table.organizationId),
    index("sessions_project_started_at_idx").on(table.projectId, table.startedAt),
    index("sessions_connection_id_idx").on(table.connectionId),
  ],
);
