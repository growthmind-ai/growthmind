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

// Drizzle's pg-core enum column needs a literal `[string,...string[]]` tuple; each
// tuple below is compile-time pinned to its @growthmind/shared union via `satisfies`,
// so a typo'd or stale value here is a compile error. packages/shared's Zod schemas
// stay the single runtime source of truth. These literals are checked against their
// types, never re-declared free-hand.
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

/**
 * One analytics attachment per project.
 *
 * `organizationId` is stamped directly rather than reached through a join on
 * `projectId`, the same deliberate denormalization `write_keys` carries, and for the
 * same reason: every scoped read filters on `ctx.organizationId` and every mutation
 * keys `(org, id)` with no join anywhere, so the "no id-only mutation" rule stays
 * mechanically uniform with zero exceptions.
 */
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
    /** The customer's region URL. */
    host: text("host").notNull(),
    /** The vendor's own project id, held as opaque text. */
    sourceProjectId: text("source_project_id").notNull(),
    /**
     * The AES-256-GCM envelope: `v1.<keyId>.<iv>.<tag>.<ciphertext>`. Self-describing
     * and versioned, so a row written under a retired key is identifiable rather than
     * an opaque decrypt failure. NO repository method returns this column.
     */
    credentialCiphertext: text("credential_ciphertext").notNull(),
    /** The first 8 hex chars of `sha256(key)`. A fingerprint, never the key. Makes key
     * rotation a migratable event instead of a fork. */
    credentialKeyId: text("credential_key_id").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    health: text("health", { enum: CONNECTION_HEALTHS }).notNull(),
    healthReasonCode: text("health_reason_code", { enum: FAILURE_CODES }),
    /** Plain English, from packages/shared's messages module. Never the vendor's own
     * `detail` text. */
    healthReasonMessage: text("health_reason_message"),
    healthCheckedAt: timestamp("health_checked_at", { withTimezone: true }),
    /**
     * The newest event time we have contiguously covered. `null` means never polled.
     * Deliberately distinct from "polled and found nothing", which is a poll-run
     * outcome, not an absent watermark.
     */
    watermarkAt: timestamp("watermark_at", { withTimezone: true }),
    /**
     * Set when a walk stopped on the page cap: the `before` cursor value of the page it
     * stopped at, stored as the wire string verbatim. The next invocation resumes the
     * unfinished backward walk from here before starting a new forward pass, which is
     * what makes "never a silent truncation" structural rather than disciplined.
     */
    backfillBefore: text("backfill_before"),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }).defaultNow().notNull(),
    /** Per-connection, so the cadence is changeable without a deploy. 60 s because
     * PostHog's own event-leg p90 retrieval is ~25 s and polling faster than the vendor
     * surfaces data buys nothing. */
    pollIntervalSeconds: integer("poll_interval_seconds").default(60).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    /** Inferred from the org creator's email domain, free-mail-guarded.
     * Persisted alongside its provenance so the value can be shown before it takes
     * effect, which is what OQ-5's future correction screen needs. */
    inferredInternalDomain: text("inferred_internal_domain"),
    internalDomainProvenance: text("internal_domain_provenance", {
      enum: INTERNAL_DOMAIN_PROVENANCES,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // settled by a constraint, never by a prior read: a second active attachment on one
    // project is refused by the database, so two concurrent attach attempts cannot both
    // win. Deactivated rows stay, so history survives a cutover.
    uniqueIndex("project_connections_active_project_uidx")
      .on(table.projectId)
      .where(sql`${table.isActive}`),
    index("project_connections_organization_id_idx").on(table.organizationId),
    index("project_connections_next_poll_at_idx").on(table.nextPollAt),
  ],
);
