import { randomUUID } from "node:crypto";

import type { AncestryReason } from "@growthmind/shared";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/shared's Zod union (C-f, D9).
const ANCESTRY_REASONS = [
  "surface_normalisation_version_bump",
  "evidence_shape_version_bump",
  "signature_tuple_version_bump",
  "surface_rename",
  "surface_derivation_swap",
] as const satisfies readonly [AncestryReason, ...AncestryReason[]];

/**
 * The old-signature -> new-signature mapping that migrates a ledger row
 * forward across identity churn (O-006 ADD §2 D-3, D12, §5 Wave 3).
 *
 * ── THE UNIQUE INDEX IS WHAT MAKES THE WALK TERMINATE ───────────────────────
 * `(organization_id, old_signature)` unique means EXACTLY ONE forward edge
 * per old signature — that is what makes the forward-resolution walk
 * single-valued (never two candidate next-hops to choose between) and
 * therefore terminating, and it is what makes a CYCLE detectable (a
 * `visited` set) rather than an unbounded read hanging the caller. A second
 * edge for the same old signature is impossible BY THE INDEX, not by
 * convention.
 *
 * ── `project_id` IS STAMPED, NEVER FILTERED ON (D-10's declared exemption,
 * T-DB-8) ────────────────────────────────────────────────────────────────────
 * The ancestry read is project-agnostic BY CONSTRUCTION: `project_id` is
 * already INSIDE the hash (ADD D-5 — it is one of the four tuple inputs), so
 * one `old_signature` value cannot legitimately span two projects. Stamping
 * it here is for auditability only, never a filter.
 *
 * ── EMPTY AT MVP, BY DESIGN (Ruling 1) ──────────────────────────────────────
 * At MVP, `surface_id` is the normalised URL path and nothing re-keys it —
 * this table has ZERO rows in production until a later outcome's
 * surface-derivation swap. `recordAncestry` and the forward-resolution walk
 * are exercised ONLY by tests until then: a caller must degrade cleanly
 * against an empty table (resolve to the input signature, zero hops), not
 * merely "not crash".
 *
 * ── `reason` IS THE EXTENSION POINT FOR FUTURE CHURN CLASSES ────────────────
 * Adding a member to `AncestryReason`
 * (`packages/shared/src/signatures/types.ts`) must stay a one-line change —
 * the column is `text({ enum })`, never `pgEnum`, exactly so a new reason
 * never requires an `ALTER TYPE`.
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
    /** Stamped, never filtered on — see the table header. */
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
