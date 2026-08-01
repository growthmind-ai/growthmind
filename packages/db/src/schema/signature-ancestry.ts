import { randomUUID } from "node:crypto";

import type { AncestryReason } from "@growthmind/shared";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/shared's Zod union.
const ANCESTRY_REASONS = [
  "surface_normalisation_version_bump",
  "evidence_shape_version_bump",
  "signature_tuple_version_bump",
  "surface_rename",
  "surface_derivation_swap",
] as const satisfies readonly [AncestryReason, ...AncestryReason[]];

/**
 * The old-signature -> new-signature mapping that migrates a ledger row forward across
 * identity churn.
 *
 * The unique index is what makes the walk terminate `(organization_id, old_signature)`
 * unique means exactly one forward edge per old signature. That is what makes the
 * forward-resolution walk single-valued (never two candidate next-hops to choose
 * between) and therefore terminating, and it is what makes a cycle detectable (a
 * `visited` set) rather than an unbounded read hanging the caller. A second edge for
 * the same old signature is impossible by the index, not by convention.
 *
 * `project_id` is stamped, never filtered on (the declared exemption,
 * T-DB-8) The ancestry read is project-agnostic by construction: `project_id` is
 * already inside the hash (add. It is one of the four tuple inputs), so one
 * `old_signature` value cannot legitimately span two projects. Stamping it here is for
 * auditability only, never a filter.
 *
 * Empty at MVP, by design (Ruling 1) At MVP, `surface_id` is the normalised URL path
 * and nothing re-keys it. This table has zero rows in production until a later
 * outcome's surface-derivation swap. `recordAncestry` and the forward-resolution walk
 * are exercised only by tests until then: a caller must degrade cleanly against an
 * empty table (resolve to the input signature, zero hops), not merely "not crash".
 *
 * `reason` is the extension point for future churn classes Adding a member to
 * `AncestryReason` (`packages/shared/src/signatures/types.ts`) must stay a one-line
 * change. The column is `text({ enum })`, never `pgEnum`, exactly so a new reason never
 * requires an `ALTER TYPE`.
 */
export const signatureAncestry = pgTable(
  "signature_ancestry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Stamped, never filtered on. See the table header. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    oldSignature: text("old_signature").notNull(),
    newSignature: text("new_signature").notNull(),
    reason: text("reason", { enum: ANCESTRY_REASONS }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signature_ancestry_org_old_signature_key").on(
      table.organizationId,
      table.oldSignature,
    ),
    index("signature_ancestry_organization_id_idx").on(table.organizationId),
  ],
);
