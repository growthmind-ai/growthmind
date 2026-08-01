import { randomUUID } from "node:crypto";

import type { FindingClass } from "@growthmind/core";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/core's Zod union, the same `text({
// enum })` + `as const satisfies` discipline `session-source-poll-runs.ts` uses for its
// shared-package enums, applied here against `packages/core` because `symptomClass` IS
// `CandidateFinding.finalClass`, a `FindingClass` (`db -> core` is legal, `core ->
// db` is not, and never will be).
const FINDING_CLASSES = [
  "broken",
  "confusing",
  "changed_mind",
  "instrumentation",
] as const satisfies readonly [FindingClass, ...FindingClass[]];

/**
 * The signature ledger, one row per distinct finding identity, holding its lifetime
 * state (architecture.md:143-145, Wave 3).
 *
 * No foreign key to `findings` (closes OQ-5) `findings` did not exist when this table
 * shipped, so a FK here would have coupled this migration to a table absent from the
 * branch's history. It exists now (`./findings.ts`), and carries a `signature` column
 * of its own, so the reason above has expired and this note records what replaced it,
 * rather than an obsolete claim that no such column exists.
 *
 * The FK is still not added, and the reason is the ledger's shape rather than the
 * table's absence: the ledger is keyed by signature, and its lifetime state outlives
 * any individual finding row. A finding can be re-derived and re-delivered against the
 * same signature, and the ledger's job is to remember across that, not to point at one
 * row. `findings.signature` is a stored copy of this table's key. The
 * `deliveries.signature` / `dismissals.signature` pattern, so an identity resolves
 * without a join, and not a second producer: `computeFindingSignature` remains the only
 * function that mints one. A `dismissals.finding_id -> findings.id` FK is the
 * deliberate target of a later sprint.
 *
 * `architecture.md:145` fields deliberately absent, and not precluded That line names
 * the ledger's eventual full state: "first seen, times seen, delivered at, dismissed
 * at, experiments run, verdicts reached, human overrides." This table carries the first
 * four. `experiments run`, `verdicts reached`, and `human overrides` are not columns
 * here. The scope is identity + suppression, not experiment tracking (a later outcome's
 * concern), and their absence is a stated scope boundary, not an oversight: a later
 * sprint adds columns to this table, it never needs a second one, because the signature
 * is already the ledger's primary key.
 *
 * Closing window (identity-key.ts:55-64 style) Nothing has shipped against this table
 * yet. It lands empty in every environment. That means there is nothing to backfill
 * today. That is a closing window, not a standing exemption: the day a real signature
 * is recorded, every decision above (no FK, no experiment columns) is a real constraint
 * on production data, not a hypothetical, and whoever changes it owns the migration
 * path.
 */
export const findingSignatures = pgTable(
  "finding_signatures",
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
    /** 64-char lowercase hex sha256 digest. Branded `SignatureHex` at the repository
     * boundary (`packages/db/src/signatures/hex.ts`). A plain `text` column here,
     * because a Drizzle column type carries no brand. */
    signature: text("signature").notNull(),
    symptomClass: text("symptom_class", { enum: FINDING_CLASSES }).notNull(),
    /** Provenance beside identity, not re-derived from `signature`. */
    surface: text("surface").notNull(),
    signatureTupleVersion: integer("signature_tuple_version").notNull(),
    evidenceShapeVersion: integer("evidence_shape_version").notNull(),
    /** `null` = written before versions were recorded ( precedent,
     * `evidence-shape.ts:54`). */
    surfaceNormalisationVersion: integer("surface_normalisation_version"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    timesSeen: integer("times_seen").default(1).notNull(),
    /** Stamped only by `markSignatureDelivered`, `recordSignature` (the re-record path)
     * must never touch this column. This is the most dangerous line: a re-record that
     * clears a delivery would make the `already_delivered` suppress branch unreachable
     * in production. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Stamped only inside `recordDismissal`'s transaction. Permanent once set; no
     * write path ever clears it. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("finding_signatures_org_project_signature_key").on(
      table.organizationId,
      table.projectId,
      table.signature,
    ),
    index("finding_signatures_organization_id_idx").on(table.organizationId),
  ],
);
