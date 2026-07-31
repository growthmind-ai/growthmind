import { randomUUID } from "node:crypto";

import type { SummarySource } from "@growthmind/shared";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { analysisRuns } from "./analysis-runs";
import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuple compile-pinned to @growthmind/shared's Zod union (D9), the same
// discipline `deliveries.ts:14-17` and `session-source-poll-runs.ts:11-27` use.
// SIX members, not five: `floor_model_output_invalid` and
// `floor_model_text_rejected` are deliberately distinct ("a shape we could not
// parse" vs "a parseable shape asserting something it may not"), and this
// column is where that distinction becomes durable rather than merely typed.
const SUMMARY_SOURCES = [
  "model_rendered",
  "floor_no_key_configured",
  "floor_cap_exhausted",
  "floor_model_call_failed",
  "floor_model_output_invalid",
  "floor_model_text_rejected",
] as const satisfies readonly [SummarySource, ...SummarySource[]];

// What `surface` below is a claim ABOUT — the persisted form of
// `claimSubjectSchema` (`packages/core/src/detect/types.ts:142-143`), which is
// `z.literal("surface")` today. Pinned as a one-member column enum rather than
// by `satisfies` because that literal is not exported from `@growthmind/core`'s
// barrel; whoever exports it, or adds a second claim subject, MUST widen this
// tuple in the same change — a claim about something that is not a surface,
// stored under a column that can only say "surface", is a silent lie.
const SURFACE_ROLES = ["surface"] as const;

/**
 * One row per finding the analysis lane persisted (O-011 FR-M7, ADD AD-1/AD-5/
 * AD-8). The FIRST analysis-side persistence in this repository.
 *
 * ── THIS TABLE'S CONSUMER IS THE DELIVERY LANE, AND THE WIRE IS NOT BUILT ────
 * (Mandatory deferral, ADD AD-12.) Nothing reads these rows yet. Delivery is
 * missing two halves — a lane source and a poster built from a
 * `slack_connections` row that does not exist — so wiring candidates through
 * now would produce a wire that LOOKS connected and is not (D11). The wire
 * lands with the first sprint that needs findings flowing to delivery, and
 * this paragraph stands until it does. The same statement is carried on
 * `packages/db/src/repositories/findings.repo.ts`.
 *
 * ── `signature` IS THE FINDING'S IDENTITY, NOT A HANDLE (D12, ADD v2 AD-20) ──
 * The column stores the signature O-006's ledger already defines, and identity
 * still has exactly ONE PRODUCER: `computeFindingSignature`
 * (`../services/signature-ledger.service.ts`), which composes `signatureTuple`
 * (pure, `@growthmind/core`) and `sha256Hex`. Nothing re-implements that hash —
 * the walker (`worker/src/tasks/analysis-tick.ts`) calls that one function and
 * writes what it returns. A stored copy beside the ledger is the pattern
 * `deliveries.signature` and `dismissals.signature` already set twice, for the
 * reason recorded at `deliveries.ts:107-109`: an identity that resolves without
 * a join to the row that carries it.
 *
 * The D12 hazard a stored identity raises is FORKING — a signature is exactly
 * as stable as its least stable input, and `surface` is re-derived. That hazard
 * is answered, and answered elsewhere on purpose: O-006 shipped
 * `signature_ancestry` (`./signature-ancestry.ts`, `consultSignature`'s
 * old→new resolution), so a signature that legitimately churns has a recorded
 * migration path rather than a silent second life (AC-D12). `signature_version`
 * sits beside the value so provenance is READ, never re-derived — the same
 * discipline as `finding_signatures.signature_tuple_version`.
 *
 * What a POSITIONAL key would have done instead is the reason this column is
 * what it is: an ordinal-and-tick-instant handle mints a fresh identity every
 * hour, so the unique index below matches nothing, the cap's lifetime ceiling
 * becomes a per-tick one, and `findBySignature`'s reuse rung never hits (ADD v2
 * AD-20, which overrules v1 AD-13).
 *
 * ── THE UNIQUE INDEX IS THE RETRY GUARD (D4) ────────────────────────────────
 * `findings_org_project_signature_key` is UNIQUE on
 * `(organization_id, project_id, signature)`. `persist` inserts against it and
 * reads the existing row on conflict, so a Graphile Worker replay of the
 * analysis task is a conflict rather than a second finding — and so is a LATER
 * TICK that re-derives the same identity, which is what makes "one row per
 * problem per project" true rather than aspirational. The tuple leads with
 * `organization_id` on purpose: a signature is content-derived, so two
 * organizations with the same funnel shape on the same page path WILL produce
 * the same string. An index without the org column would hand whichever org ran
 * second the other's finding back through its own ON CONFLICT read.
 *
 * ── TEXT IS A HEADLINE PLUS A SENTENCE ARRAY (AD-8) ─────────────────────────
 * `headline` is text; `context` is jsonb holding `readonly string[]`, ONE
 * SENTENCE PER ELEMENT, for both lanes. The SAC guard's judgement is per
 * sentence, and O-007's Slack renderer and residual-PII scanner both consume
 * sentences — re-splitting prose downstream is the step that stops being
 * reliable the moment a model writes it. The model arm is split ONCE, by the
 * guard, before it reaches this column, and never again.
 *
 * ── JSONB IS PARSED AT THE BOUNDARY, NEVER TRUSTED (D5) ─────────────────────
 * `context` and `counts` are intentionally left as `unknown` at the type level.
 * A jsonb column holds every shape ever written, not the shape the current code
 * writes, so the repository validates BOTH on write and on read. A `$type<…>()`
 * annotation here would be a promise about persisted data that nothing
 * enforces.
 *
 * ── NULL MEANS NOT REPORTED, NEVER ZERO (AD-5, FR-M9) ───────────────────────
 * `resolved_model_id` is null iff no call was attempted for this candidate —
 * and that holds on EVERY path, including the defensive one where the port
 * throws instead of returning, because the lane carries the model id the
 * composition root resolved beside the port itself
 * (`worker/src/tasks/analysis-tick.ts`, `ConfiguredSummariser`). There is no
 * path on which an attempted call lands a null here.
 * `tokens_in` / `tokens_out` are null when the SDK reported no count
 * (`shared/src/summary/types.ts:163-173`) — a candidate the model touched but
 * did not meter must never look identical to one that cost nothing. A
 * genuinely reported `0` is a different, storable fact.
 * `surface_normalisation_version` is null for the same class of reason: the
 * candidate contract makes it `z.number().int().nullable()` and NOT
 * `.positive()` (`core/src/findings/candidate.ts:93`), so `0` is a version a
 * normaliser may legitimately report. Writing `0` to mean "none recorded"
 * would make "normaliser v0" and "we do not know" the same stored value, on a
 * column that feeds D12 identity comparisons — the exact defect the token
 * columns above exist to avoid.
 *
 * ── CLOSING WINDOW ──────────────────────────────────────────────────────────
 * Nothing has shipped against this table — it lands empty in every environment,
 * so there is nothing to backfill TODAY. That is a closing window, not a
 * standing exemption.
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
    /** Stamped by every write AND filtered on by every read (`listForProject`,
     * `findBySignature`) — stamp/filter symmetry, D2. A filter keyed on a
     * column no write stamps matches zero rows and reads as "no data", never
     * as an error. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The run that produced this finding. FK'd because both tables land in
     * the same migration — unlike `deliveries.finding_id`, there is no frozen
     * suite inserting synthetic ids here.
     *
     * RESTRICT, NOT CASCADE (D8 cleanup class). `analysis_runs` is an audit
     * trail; `findings` is the product's primary artifact. A cascade here would
     * mean deleting one run row — a tidy-up, a retention job, a hand-run
     * script — silently destroys every finding that run produced, and the same
     * delete would take the run's cap-claim rows with it (see
     * `analysis-model-calls.ts`), re-opening budget the customer was already
     * told was spent. The org and project cascades below are the real
     * tenant-deletion path and are deliberately left alone. */
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "restrict" }),
    /** THE FINDING'S IDENTITY, derived from its own content by the one
     * producer — see the header. Scoped to `(organization_id, project_id)` by
     * the unique index below, never by this column alone. */
    signature: text("signature").notNull(),
    /** Provenance beside identity, READ and never re-derived — the
     * `finding_signatures.signature_tuple_version` discipline. A signature and
     * the version of the tuple serialisation that produced it are one fact;
     * separating them is how a normaliser bump becomes an invisible fork. */
    signatureVersion: integer("signature_version").notNull(),
    /** How the written summary was produced. Every `floor_*` member is an
     * ABSENCE statement about the EXPLANATION, never a claim about the
     * finding: the numbers below are identical whichever member applies
     * (SAC-6). */
    summarySource: text("summary_source", { enum: SUMMARY_SOURCES }).notNull(),
    headline: text("headline").notNull(),
    /** `readonly string[]`, one sentence per element — see the header. */
    context: jsonb("context").notNull(),
    // --- the candidate's gate-proven state, so a finding is re-explicable
    //     from its own row without re-running the detector ---------------------
    finalClass: text("final_class").notNull(),
    surface: text("surface").notNull(),
    /** What `surface` is a claim ABOUT — see `SURFACE_ROLES` above. */
    surfaceRole: text("surface_role", { enum: SURFACE_ROLES }).notNull().default("surface"),
    /** The version of the path normaliser that produced `surface`. Recorded so
     * a normaliser change is a visible, comparable fact rather than a silent
     * re-derivation (D12).
     *
     * NULLABLE, AND NULL IS THE FACT "no version was recorded" — never a
     * sentinel. See the header: `0` is a version a producer may legitimately
     * emit, so it cannot also carry the absence. */
    surfaceNormalisationVersion: integer("surface_normalisation_version"),
    /** `MeasuredCount` rows — each a numerator WITH its denominator, its unit,
     * its timeframe and its basis. Parsed at the boundary, never trusted. */
    counts: jsonb("counts").notNull(),
    /** Plain English, and always a statement about MEASUREMENT — never a
     * numeric confidence (SAC-12). */
    confidenceBasis: text("confidence_basis").notNull(),
    /** The measurement window these counts describe. Persisted as instants, so
     * no consumer has to reconstruct "this week" from prose. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    /** An input to `signature` above — persisted so the stored identity stays
     * RE-DERIVABLE from this row through the one producer, rather than being a
     * value nobody can check. */
    evidenceShape: text("evidence_shape").notNull(),
    evidenceShapeVersion: integer("evidence_shape_version").notNull(),
    /** Per-call attribution (AD-5). Null iff no call was attempted for this
     * candidate — never where one was attempted and failed, and never where one
     * was attempted and threw. See the header for what makes that true on every
     * path rather than on most of them. */
    resolvedModelId: text("resolved_model_id"),
    /** Null = NOT REPORTED. NEVER `0` — see the header. */
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // THE retry guard (D4) — see the header for why the org column leads.
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
    // "What did this run produce?" — the run-scoped read, still org-first.
    index("findings_org_run_id_idx").on(table.organizationId, table.runId),
  ],
);
