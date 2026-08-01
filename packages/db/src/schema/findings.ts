import { randomUUID } from "node:crypto";

import type { SummarySource } from "@growthmind/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { analysisRuns } from "./analysis-runs";
import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/shared's Zod union, the same discipline
// `deliveries.ts:14-17` and `session-source-poll-runs.ts:11-27` use. Six members, not
// five: `floor_model_output_invalid` and `floor_model_text_rejected` are deliberately
// distinct ("a shape we could not parse" vs "a parseable shape asserting something it
// may not"), and this column is where that distinction becomes durable rather than
// merely typed.
const SUMMARY_SOURCES = [
  "model_rendered",
  "floor_no_key_configured",
  "floor_cap_exhausted",
  "floor_model_call_failed",
  "floor_model_output_invalid",
  "floor_model_text_rejected",
] as const satisfies readonly [SummarySource, ...SummarySource[]];

// What `surface` below is a claim about. The persisted form of `claimSubjectSchema`
// (`packages/core/src/detect/types.ts:142-143`), which is `z.literal("surface")` today.
// Pinned as a one-member column enum rather than by `satisfies` because that literal is
// not exported from `@growthmind/core`'s barrel; whoever exports it, or adds a second
// claim subject, must widen this tuple in the same change. A claim about something that
// is not a surface, stored under a column that can only say "surface", is a silent lie.
const SURFACE_ROLES = ["surface"] as const;

/**
 * One row per finding the analysis lane persisted. Identity is the `signature` column,
 * with exactly one producer (`computeFindingSignature`), and the unique index
 * `findings_org_project_signature_key` is the retry guard that makes "one row per
 * problem per project" true under worker replays. Both readers, the first-run status
 * read and the delivery lane source, reach these rows through the repository under an
 * org-scoped context and never any other way.
 *
 * Design rationale: docs/decisions/0010-findings-schema.md
 */
export const findings = pgTable(
  "findings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Stamped by every write and filtered on by every read (`listForProject`,
     * `findBySignature`). Stamp/filter symmetry,. A filter keyed on a column no write
     * stamps matches zero rows and reads as "no data", never as an error. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The run that produced this finding. Fk'd because both tables land in the same
     * migration. Unlike `deliveries.finding_id`, there is no frozen suite inserting
     * synthetic ids here.
     *
     * Restrict, not cascade (cleanup class). `analysis_runs` is an audit trail;
     * `findings` is the product's primary artifact. A cascade here would mean deleting
     * one run row (a tidy-up, a retention job, a hand-run script) silently destroys
     * every finding that run produced, and the same delete would take the run's
     * cap-claim rows with it (see `analysis-model-calls.ts`), re-opening budget the
     * customer was already told was spent. The org and project cascades below are the
     * real tenant-deletion path and are deliberately left alone. */
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "restrict" }),
    /** The finding's identity, derived from its own content by the one producer. See
     * the design doc. Scoped to `(organization_id, project_id)` by the unique index
     * below, never by this column alone. */
    signature: text("signature").notNull(),
    /** Provenance beside identity, read and never re-derived. The
     * `finding_signatures.signature_tuple_version` discipline. A signature and the
     * version of the tuple serialisation that produced it are one fact; separating them
     * is how a normaliser bump becomes an invisible fork. */
    signatureVersion: integer("signature_version").notNull(),
    /** How the written summary was produced. Every `floor_*` member is an absence
     * statement about the explanation, never a claim about the finding: the numbers
     * below are identical whichever member applies (SAC-6). */
    summarySource: text("summary_source", { enum: SUMMARY_SOURCES }).notNull(),
    headline: text("headline").notNull(),
    /** `readonly string[]`, one sentence per element. See the design doc. */
    context: jsonb("context").notNull(),
    // The candidate's gate-proven state, so a finding is re-explicable
    // from its own row without re-running the detector
    finalClass: text("final_class").notNull(),
    surface: text("surface").notNull(),
    /** What `surface` is a claim about. See `SURFACE_ROLES` above. */
    surfaceRole: text("surface_role", { enum: SURFACE_ROLES }).notNull().default("surface"),
    /** The version of the path normaliser that produced `surface`. Recorded so a
     * normaliser change is a visible, comparable fact rather than a silent
     * re-derivation.
     *
     * Nullable, and NULL is the fact "no version was recorded", never a sentinel. See
     * the design doc: `0` is a version a producer may legitimately emit, so it cannot
     * also carry the absence. */
    surfaceNormalisationVersion: integer("surface_normalisation_version"),
    /** `MeasuredCount` rows, each a numerator with its denominator, its unit, its
     * timeframe and its basis. Parsed at the boundary, never trusted. */
    counts: jsonb("counts").notNull(),
    /** Plain English, and always a statement about measurement, never a numeric
     * confidence (SAC-12). */
    confidenceBasis: text("confidence_basis").notNull(),
    /** The measurement window these counts describe. Persisted as instants, so no
     * consumer has to reconstruct "this week" from prose. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    /** An input to `signature` above. Persisted so the stored identity stays
     * re-derivable from this row through the one producer, rather than being a value
     * nobody can check. */
    evidenceShape: text("evidence_shape").notNull(),
    evidenceShapeVersion: integer("evidence_shape_version").notNull(),
    /** Per-call attribution: `resolved_model_id` is null iff no call was attempted for
     * this candidate, never where one was attempted and failed, and never where one was
     * attempted and threw. See the design doc for what makes that true on every path
     * rather than on most of them. */
    resolvedModelId: text("resolved_model_id"),
    /** Null = not reported. Never `0`, see the design doc. */
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The retry guard, see the design doc for why the org column leads.
    uniqueIndex("findings_org_project_signature_key").on(
      table.organizationId,
      table.projectId,
      table.signature,
    ),
    index("findings_organization_id_idx").on(table.organizationId),
    // `listForProject`'s read: org + project, newest first.
    index("findings_org_project_created_at_idx").on(
      table.organizationId,
      table.projectId,
      table.createdAt,
    ),
    // "What did this run produce?". The run-scoped read, still org-first.
    index("findings_org_run_id_idx").on(table.organizationId, table.runId),
  ],
);
