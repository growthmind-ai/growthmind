import { randomUUID } from "node:crypto";

import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { analysisRuns } from "./analysis-runs";
import { organization } from "./auth";
import { projects } from "./projects";

/**
 * The cap claim ledger. One row per model call this product has committed to making for
 * a project. The durable accounting behind both hard cost ceilings, the per-project one
 * and the organisation-wide one.
 *
 * One statement, no prior read, two ceilings a claim is a single conditional insert:
 *
 *  INSERT INTO analysis_model_calls
 *  SELECT … WHERE (SELECT count FROM analysis_model_calls c
 *  Where c.organization_id = $org and c.project_id = $project)
 *  < $projectCap
 *  AND (SELECT count FROM analysis_model_calls c
 *  Where c.organization_id = $org) < $organizationCap
 *  ON CONFLICT (organization_id, project_id, signature) DO NOTHING
 *  RETURNING id
 *
 * The second conjunct is what makes the first a real ceiling: nothing limits how many
 * projects an organisation creates, so a per-project cap alone bounds `projectCap × N`
 * with no N. Both ceilings read this table, which is why one ledger is enough for two
 * limits, and why nothing may prune it.
 *
 * A returned row means this caller owns the call. No row means either a cap is spent or
 * this candidate was already claimed, disambiguated by a scoped read of the same tuple
 * after the write, which is not a check-then-write window, because no model call is
 * made on either branch of it. The two refusals must never collapse: `already_claimed`
 * means a prior run already did this work (reuse its finding, make no call), while
 * `cap_exhausted` means persist at the floor with `floor_cap_exhausted` and record
 * `stop_reason = cap_exhausted` on the run. Reading one as the other would either
 * report an over-spend that never happened or send the lane looking for a finding that
 * was never written.
 *
 * The count subquery is only exact because `analysis_runs` carries a partial unique
 * index on `(organization_id, project_id) WHERE status = 'running'`: a cross-run
 * aggregate inside a predicate is not serialised, so single-writer-per-project is what
 * makes the arithmetic hold under concurrency. See `analysis-runs.ts`'s header, the two
 * tables are one mechanism.
 *
 * The cap is counted per project, lifetime, keyed on the finding's identity (which
 * overrules v1. Read this before hanging anything off this column.) `signature` is the
 * same identity `findings.signature` carries, derived by the same single producer
 * `computeFindingSignature` (`../services/signature-ledger.service.ts`); this table
 * stores no second derivation and introduces no second hash. `signature_version`
 * records which tuple serialisation produced it, read rather than re-derived.
 *
 * That is what makes the ceiling below a ceiling: one claim per distinct problem per
 * project, counted over the lifetime of these rows. A positional or tick-prefixed
 * handle would mint a fresh key every tick, so the unique index would match nothing and
 * a lifetime cap of N would silently become N per tick. the churn hazard for a
 * content-derived key is not closed today, and this ceiling is one of the things that
 * costs. The mechanism exists, the `signature_ancestry` records an old→new mapping
 * , but its producer does not: nothing in production calls `recordAncestry`
 * (`../services/signature-ledger.service.ts`), so a customer route rename, a
 * `URL_PATH_NORMALISATION_VERSION` bump or the M1 ts-morph derivation swap forks the
 * signature with no edge written. A forked signature is a fresh row here, which
 * re-opens lifetime budget for a problem already paid for, under both ceilings.
 * `./findings.ts`'s header carries the full account and names the heir (a caller, on
 * whichever path re-derives a surface).
 *
 * Two candidates on one signature are one claim. Deliberately. The budget is the right
 * to write up a problem, not the right to write up a row.
 *
 * No usage columns, deliberately This is a claim ledger. `resolved_model_id` and token
 * counts live on `findings` (per call) and `analysis_runs` (per run); adding them here
 * would create a second home for the same fact and a third thing to keep in sync.
 *
 * Lifetime window Rows are never pruned by the lane. Both windows are lifetimes over
 * these rows: the per-project ceiling counts the lifetime of one `(organization_id,
 * project_id)` pair (the project's first check) and the organisation-wide ceiling
 * counts the lifetime of one `organization_id` across every project it has. That is
 * what makes the shipped customer sentence. "the limit on written explanations for this
 * product's first check was already reached". True of the per-project ceiling; the
 * organisation-wide one renders the same sentence and knowingly names the wrong scope,
 * for the reason `worker/src/analysis-cap.ts`'s header states out loud. Deleting rows
 * here would silently re-open budget the customer was already told was spent, under
 * either ceiling.
 */
export const analysisModelCalls = pgTable(
  "analysis_model_calls",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Stamped by the claim and filtered by the count subquery and the disambiguating
     * read. Stamp/filter symmetry, and here a dropped predicate is invisible in the
     * return value: a widened count simply spends another org's budget without
     * erroring. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The run that took this claim. Attribution only, the cap is counted per project,
     * never per run.
     *
     * Restrict, not cascade. The lifetime window note below is the whole reason: a
     * cascade from `analysis_runs` would make deleting one audit-trail row a silent
     * refund of the budget the customer was already told was spent, and the shipped
     * sentence about a first check's limit would stop being true. The org and project
     * cascades above are the real tenant-deletion path. */
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "restrict" }),
    /** The finding's identity, from the one producer. See the header. The same value
     * `findings.signature` carries for the same problem. */
    signature: text("signature").notNull(),
    /** Which tuple serialisation produced `signature`. Stored, never re-derived,
     * `finding_signatures.signature_tuple_version`'s discipline. */
    signatureVersion: integer("signature_version").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // The retry guard. A replayed claim conflicts here instead of consuming a second
    // unit of budget.
    uniqueIndex("analysis_model_calls_org_project_signature_key").on(
      table.organizationId,
      table.projectId,
      table.signature,
    ),
    // The index the organisation-wide ceiling's count subquery lands on. Executed once
    // per candidate, beside the per-project one below.
    index("analysis_model_calls_organization_id_idx").on(table.organizationId),
    // The index the per-project ceiling's count subquery lands on. The hottest read in
    // the lane, executed once per candidate.
    index("analysis_model_calls_org_project_idx").on(table.organizationId, table.projectId),
  ],
);
