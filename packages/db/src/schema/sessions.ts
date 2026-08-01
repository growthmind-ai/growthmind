import { randomUUID } from "node:crypto";

import type { ExclusionReason, IdentityResolution, Origin } from "@growthmind/shared";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projectConnections } from "./project-connections";
import { projects } from "./projects";

// Enum tuples compile-pinned to @growthmind/shared's Zod unions.
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

/**
 * An assembled session.
 *
 * `tier_reached` and `cost_cents` (which architecture names on this table) deliberately
 * do not land yet: no write path in this sprint stamps either, and a column nobody
 * writes is exactly the "filter returns zero rows and reads as no-data" failure
 * architecture rule 1 exists to name. Adding them later is `ALTER TABLE … ADD COLUMN …
 * NULL`, generated, with no data migration. Asymmetric, so deferred.
 */
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
    /** From `deriveSessionKey`. Versioned by `groupingVersion` below. */
    sessionKey: text("session_key").notNull(),
    /**
     * A project-salted sha256 hash of PostHog's raw `distinct_id`, never the raw value
     * itself (product-decisions, prd). Named `identity_key`, not `identity_id`:
     * architecture the `identity_id` implies the `identities` table that full stitching
     * creates and this sprint does not. A `_id` column with no referent would make a
     * later wave write a join to a table that does not exist, and would turn the real
     * `identities` table into a rename migration. The later stitcher maps this key,
     * which is exactly the "nothing keyed in a way a later real stitcher cannot
     * re-derive".
     */
    identityKey: text("identity_key"),
    /** Domain only, never the address (product-decisions). */
    identityEmailDomain: text("identity_email_domain"),
    /** Three-state, notNull: "we did not check" is a value, not an absence. */
    identityResolution: text("identity_resolution", { enum: IDENTITY_RESOLUTIONS }).notNull(),
    /** Sec-a: SDK-set and may be absent. An absent UA classifies as `none`, never as
     * automation. */
    userAgent: text("user_agent"),
    entryUrlPath: text("entry_url_path"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    /** This sprint's only writer stamps `real`; `synthetic` arrives with simulation.
     * Reuses the existing shared `originSchema`, not redefined. */
    origin: text("origin", { enum: ORIGINS }).notNull(),
    /**
     * Not NULL, with an explicit `none` member. A nullable column would make
     * "classified and kept" and "never classified" the same value. Precisely the
     * failure where absence reads as a result. Classification is total.
     */
    exclusionReason: text("exclusion_reason", { enum: EXCLUSION_REASONS }).notNull(),
    /** What the classifier saw at stamp time. The provenance of the stamp. Reproducing
     * a stored stamp uses this; the future backfill uses the project's current domain.
     * Both are expressible from persisted data with zero vendor access, which is the
     * whole property preserves. */
    internalDomainAtStamp: text("internal_domain_at_stamp"),
    exclusionRuleSetVersion: integer("exclusion_rule_set_version").notNull(),
    groupingVersion: integer("grouping_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // The upsert conflict target. Re-applying a pull is idempotent by construction
    // rather than by a prior existence check.
    uniqueIndex("sessions_project_session_key_uidx").on(table.projectId, table.sessionKey),
    index("sessions_organization_id_idx").on(table.organizationId),
    index("sessions_project_started_at_idx").on(table.projectId, table.startedAt),
    index("sessions_connection_id_idx").on(table.connectionId),
  ],
);
