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
 * One row per finding the analysis lane persisted. The first analysis-side persistence
 * in this repository.
 *
 * ── THE DEFERRAL IS DISCHARGED: THIS TABLE HAS CONSUMERS (O-008 FR-O25) ─────
 * O-011 shipped this table with the delivery wire deliberately CUT and recorded
 * why, here: a poster had to be built from a `slack_connections` row this
 * repository did not have, so wiring candidates through would have produced a
 * wire that LOOKED connected and was not (D11). That table now EXISTS — it is
 * declared beside this one (`./slack-connections.ts`) and lands in the same
 * migration as the first-run surface — so the reason has expired, and the
 * paragraph that recorded it would now read false.
 *
 * O-008 is the sprint that closes the wire, and it builds two readers of these
 * rows: the first-run status read, which takes the single newest finding for
 * the project a founder is watching, and the delivery lane source, which
 * composes an organization's undelivered findings for its own channel. Both go
 * through this table's repository under an org-scoped context, and neither
 * reaches these rows any other way. The same statement is carried on
 * `packages/db/src/repositories/findings.repo.ts`.
 *
 * `signature` is the finding's identity, not a handle The column stores the signature
 * the ledger already defines, and identity still has exactly one producer:
 * `computeFindingSignature` (`../services/signature-ledger.service.ts`), which composes
 * `signatureTuple` (pure, `@growthmind/core`) and `sha256Hex`. Nothing re-implements
 * that hash. The walker (`worker/src/tasks/analysis-tick.ts`) calls that one function
 * and writes what it returns. A stored copy beside the ledger is the pattern
 * `deliveries.signature` and `dismissals.signature` already set twice, for the reason
 * recorded at `deliveries.ts:107-109`: an identity that resolves without a join to the
 * row that carries it.
 *
 * The hazard a stored identity raises is forking. A signature is exactly as stable as
 * its least stable input, and `surface` is re-derived.
 *
 * The mechanism for that hazard exists; its producer does not, and this column ships
 * forkable today. Read that before hanging anything off this value. shipped the
 * ancestry table (`./signature-ancestry.ts`), the service method that writes an edge
 * (`recordAncestry`, `../services/signature-ledger.service.ts`) and the old→new
 * resolution that reads it (`consultSignature`, same file), but nothing in production
 * calls `recordAncestry`. Its only callers are this package's own tests, and the
 * analysis lane stubs it out. No ancestry edge is written by any shipped path, so the
 * "migration path" is a capability rather than a behaviour.
 *
 * What that costs, concretely. `@growthmind/core`'s `signature-tuple.ts` input table
 * names three live churn events for `surfaceId`. A customer route rename, a
 * `URL_PATH_NORMALISATION_VERSION` bump, and the M1 ts-morph derivation swap. Plus an
 * `EVIDENCE_SHAPE_VERSION` bump for `evidenceShape`. Any one of them forks this column
 * with no edge recorded, and the fork is silent: the unique index below matches
 * nothing, the finding re-mints as new, `findBySignature`'s reuse rung misses, the
 * cap's lifetime ceiling re-opens for a problem already paid for
 * (`./analysis-model-calls.ts`), and the dismissals quietly stop suppressing it. The
 * heir is a caller for `recordAncestry` on whichever path re-derives a surface, not a
 * second mechanism, and not another paragraph here.
 *
 * `signature_version` sits beside the value so provenance is read, never re-derived,
 * the same discipline as `finding_signatures.signature_tuple_version`.
 *
 * What a positional key would have done instead is the reason this column is what it
 * is: an ordinal-and-tick-instant handle mints a fresh identity every hour, so the
 * unique index below matches nothing, the cap's lifetime ceiling becomes a per-tick
 * one, and `findBySignature`'s reuse rung never hits (which overrules v1).
 *
 * The unique index is the retry guard `findings_org_project_signature_key` is unique on
 * `(organization_id, project_id, signature)`. `persist` inserts against it and reads
 * the existing row on conflict, so a Graphile Worker replay of the analysis task is a
 * conflict rather than a second finding, and so is a later tick that re-derives the
 * same identity, which is what makes "one row per problem per project" true rather than
 * aspirational. The tuple leads with `organization_id` on purpose: a signature is
 * content-derived, so two organizations with the same funnel shape on the same page
 * path will produce the same string. An index without the org column would hand
 * whichever org ran second the other's finding back through its own on conflict read.
 *
 * Text is a headline plus a sentence array `headline` is text; `context` is jsonb
 * holding `readonly string[]`, one sentence per element, for both lanes. The sac
 * guard's judgement is per sentence, and the Slack renderer and residual-PII scanner
 * both consume sentences. Re-splitting prose downstream is the step that stops being
 * reliable the moment a model writes it. The model arm is split once, by the guard,
 * before it reaches this column, and never again.
 *
 * JSONB is parsed at the boundary, never trusted `context` and `counts` are
 * intentionally left as `unknown` at the type level. A jsonb column holds every shape
 * ever written, not the shape the current code writes, so the repository validates both
 * on write and on read. A `$type<…>` annotation here would be a promise about
 * persisted data that nothing enforces.
 *
 * NULL means not reported, never zero `resolved_model_id` is null iff no call was
 * attempted for this candidate, and that holds on every path, including the defensive
 * one where the port throws instead of returning, because the lane carries the model id
 * the composition root resolved beside the port itself
 * (`worker/src/tasks/analysis-tick.ts`, `ConfiguredSummariser`). There is no path on
 * which an attempted call lands a null here. `tokens_in` / `tokens_out` are null when
 * the SDK reported no count (`shared/src/summary/types.ts:163-173`). A candidate the
 * model touched but did not meter must never look identical to one that cost nothing. A
 * genuinely reported `0` is a different, storable fact. `surface_normalisation_version`
 * is null for the same class of reason: the candidate contract makes it
 * `z.number.int.nullable` and not `.positive`
 * (`core/src/findings/candidate.ts:93`), so `0` is a version a normaliser may
 * legitimately report. Writing `0` to mean "none recorded" would make "normaliser v0"
 * and "we do not know" the same stored value, on a column that feeds identity
 * comparisons. The exact defect the token columns above exist to avoid.
 *
 * Closing window Nothing has shipped against this table. It lands empty in every
 * environment, so there is nothing to backfill today. That is a closing window, not a
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
     * the header. Scoped to `(organization_id, project_id)` by the unique index below,
     * never by this column alone. */
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
    /** `readonly string[]`, one sentence per element. See the header. */
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
     * the header: `0` is a version a producer may legitimately emit, so it cannot also
     * carry the absence. */
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
    /** Per-call attribution. Null iff no call was attempted for this candidate, never
     * where one was attempted and failed, and never where one was attempted and threw.
     * See the header for what makes that true on every path rather than on most of
     * them. */
    resolvedModelId: text("resolved_model_id"),
    /** Null = not reported. Never `0`, see the header. */
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The retry guard, see the header for why the org column leads.
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
