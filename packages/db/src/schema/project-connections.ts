import { randomUUID } from "node:crypto";

import type {
  ConnectionHealth,
  InternalDomainProvenance,
  SessionSourceKind,
  SourceFailureCode,
} from "@growthmind/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

const SOURCE_KINDS = ["posthog"] as const satisfies readonly [
  SessionSourceKind,
  ...SessionSourceKind[],
];

const CONNECTION_HEALTHS = [
  "validating",
  "healthy",
  "failing",
  "disconnected",
] as const satisfies readonly [ConnectionHealth, ...ConnectionHealth[]];

const FAILURE_CODES = [
  "invalid_credentials",
  "project_not_found",
  "unreachable",
  "rate_limited",
  "misconfigured",
] as const satisfies readonly [SourceFailureCode, ...SourceFailureCode[]];

const INTERNAL_DOMAIN_PROVENANCES = ["org_creator_email"] as const satisfies readonly [
  InternalDomainProvenance,
  ...InternalDomainProvenance[],
];

export const projectConnections = pgTable(
  "project_connections",
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
    sourceKind: text("source_kind", { enum: SOURCE_KINDS }).notNull(),

    host: text("host").notNull(),

    sourceProjectId: text("source_project_id").notNull(),

    credentialCiphertext: text("credential_ciphertext").notNull(),

    credentialKeyId: text("credential_key_id").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    health: text("health", { enum: CONNECTION_HEALTHS }).notNull(),
    healthReasonCode: text("health_reason_code", { enum: FAILURE_CODES }),

    healthReasonMessage: text("health_reason_message"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),

    watermarkAt: timestamp("watermark_at", { withTimezone: true }),

    backfillBefore: text("backfill_before"),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }).defaultNow().notNull(),

    pollIntervalSeconds: integer("poll_interval_seconds").default(60).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),

    inferredInternalDomain: text("inferred_internal_domain"),
    internalDomainProvenance: text("internal_domain_provenance", {
      enum: INTERNAL_DOMAIN_PROVENANCES,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("project_connections_active_project_uidx")
      .on(table.projectId)
      .where(sql`${table.isActive}`),
    index("project_connections_organization_id_idx").on(table.organizationId),
    index("project_connections_next_poll_at_idx").on(table.nextPollAt),
  ],
);
