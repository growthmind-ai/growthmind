import { randomUUID } from "node:crypto";

import type { AnalysisOutcome, AnalysisRunStatus, AnalysisStopReason } from "@growthmind/shared";
import { sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { organization } from "./auth";
import { projects } from "./projects";

// Enum tuples compile-pinned to @growthmind/shared's Zod unions (D9), the same
// `text({ enum })` + `as const satisfies` discipline `session-source-poll-runs.ts
// :11-27` uses. This is the pinning `packages/shared/src/summary/types.ts:26-31`
// hands forward as an INHERITED OBLIGATION to whoever writes this table: that
// comment says the run table is "NOT YET BUILT" and that its enum columns WILL
// BE pinned to these unions. This file is where that promise is kept — a member
// added to `analysisRunStatusSchema` / `analysisOutcomeSchema` /
// `analysisStopReasonSchema` and not added here is a COMPILE error at the
// column, never a runtime surprise in production data.
const ANALYSIS_RUN_STATUSES = ["running", "completed", "failed"] as const satisfies readonly [
  AnalysisRunStatus,
  ...AnalysisRunStatus[],
];

const ANALYSIS_OUTCOMES = [
  "produced_findings",
  "no_candidates_passed_gate",
  "no_sessions_to_analyse",
] as const satisfies readonly [AnalysisOutcome, ...AnalysisOutcome[]];

const ANALYSIS_STOP_REASONS = [
  "ran_to_completion",
  "cap_exhausted",
  "fatal_error",
] as const satisfies readonly [AnalysisStopReason, ...AnalysisStopReason[]];

/**
 * One row per project per analysis tick (O-011 FR-M8, ADD AD-4/AD-5).
 *
 * ── EVERY EXIT PATH IS TERMINAL (D8) ────────────────────────────────────────
 * `status` starts `running` and MUST reach `completed` or `failed`. A row left
 * `running` forever is not merely untidy: the partial unique index below means
 * it also permanently JAMS the project's lane, because no second run can open
 * while it stands. `failed` is therefore a first-class, writable state carrying
 * a plain-English `failure_reason`, exactly as `session_source_poll_runs` does.
 *
 * ── THE PARTIAL UNIQUE INDEX IS THE SINGLE-WRITER LOCK (AD-4, D6) ────────────
 * `analysis_runs_one_open_per_project_key` is UNIQUE on
 * `(organization_id, project_id) WHERE status = 'running'`. Two concurrent runs
 * for one project are un-insertable, which is the ONLY reason the cap claim's
 * count subquery (`analysis-model-calls.ts`) is exact rather than hopeful: a
 * cross-run aggregate inside a predicate is not serialised, so without a single
 * writer per project two runs would both read the count below the cap and both
 * proceed. The index — not a prior read, not an advisory lock — is what makes
 * the hard per-project cost cap hold under concurrency.
 *
 * ── NULLABILITY IS A STATEMENT OF FACT, NEVER A MISSING STATE ────────────────
 * `packages/shared/src/summary/types.ts:12-18` constrains this table directly:
 * the three unions above are TOTAL, so no column here may use `null` to stand
 * in for a state one of them already names. A column is nullable ONLY where
 * null is itself a fact:
 *   - `finished_at`, `outcome`, `stop_reason` — null while, and only while, the
 *     run is pre-terminal. A terminal write sets all three.
 *   - `resolved_model_id` — null ONLY where NO call was attempted at all in the
 *     whole run (`types.ts:175-182`), NEVER where one was attempted and merely
 *     failed. A failed call still addressed a model and still consumed the cap,
 *     and the lane carries the model id the composition root resolved beside
 *     the port itself, so even a port that THROWS attributes its attempt
 *     (`worker/src/tasks/analysis-tick.ts`, `ConfiguredSummariser`). There is
 *     no path on which `model_calls_attempted > 0` and this column is null.
 *   - `tokens_in` / `tokens_out` — null means NOT REPORTED, never `0`. A run
 *     whose calls all went unmetered must not read as a run that cost nothing
 *     (AD-5, FR-M9).
 *   - `failure_reason` — null on `completed`; plain English on `failed`.
 *
 * ── THE TWO CANDIDATES THAT PRODUCED NO FINDING ARE COUNTED HERE ────────────
 * `candidates_unrenderable` and `candidates_refused` are the run's record of
 * the candidates it walked past. Without them a run in which EVERY candidate
 * fell out still closes `completed` / `produced_findings` / `ran_to_completion`
 * over zero rows — "we lost some" decaying into "we checked everything", which
 * is SAC-10's own failure shape one level down from the cap.
 *
 * TWO COLUMNS, NOT ONE, and no floor sentence is invented for either. They are
 * different facts about different points in the lane, and a reader must be able
 * to tell them apart without guessing:
 *   - `candidates_refused` — the surface gate would not TRANSMIT the value at
 *     all (security audit M-1). Nothing was claimed, nothing was sent, nothing
 *     was written.
 *   - `candidates_unrenderable` — the deterministic floor could not phrase the
 *     candidate even without a model, so no honest sentence existed to store.
 * Folding them together would read as "the floor could not phrase it" when the
 * truth was "we would not transmit it". A COUNT is persisted and a sentence is
 * not, deliberately: the refusal to invent prose for these candidates is the
 * correct behaviour (`analysis-tick.ts`'s `floorTextFor`), while the fact that
 * some existed is a fact the run row owes its reader.
 *
 * `.default(0).notNull()`, matching `model_calls_attempted` below and for the
 * same reason: a closed run always observed these numbers, so zero is a fact
 * rather than a missing state. A run RECLAIMED as abandoned keeps the default,
 * exactly as it keeps `model_calls_attempted = 0` — its `status = 'failed'` and
 * `stop_reason = 'fatal_error'` are what say nobody observed its work.
 *
 * ── `model_calls_attempted` IS AN ACCOUNT, NOT A CAP LEDGER ─────────────────
 * It records how many model calls this RUN attempted, for attribution on the
 * run row. The cap itself is counted per PROJECT over the claim rows in
 * `analysis_model_calls` — a lifetime count, per AD-2's "first check" window.
 * Counting the cap off this column instead would re-consume budget on every
 * Graphile Worker replay and would count the wrong window besides.
 *
 * ── CLOSING WINDOW ──────────────────────────────────────────────────────────
 * Nothing has shipped against this table — it lands empty in every environment,
 * so there is nothing to backfill TODAY. That is a closing window, not a
 * standing exemption.
 */
export const analysisRuns = pgTable(
  "analysis_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Stamped by every write AND filtered on by every read — stamp/filter
     * symmetry (D2). A filter keyed on a column no write stamps matches zero
     * rows and reads as "no data", never as an error. */
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: ANALYSIS_RUN_STATUSES }).notNull().default("running"),
    /** Null pre-terminal only. `no_candidates_passed_gate` and
     * `no_sessions_to_analyse` are DIFFERENT answers to the same zero
     * (FR-18d) and must never be collapsed by a writer taking a shortcut. */
    outcome: text("outcome", { enum: ANALYSIS_OUTCOMES }),
    /** Null pre-terminal only. `cap_exhausted` must read as "we stopped early",
     * never as `ran_to_completion` (SAC-10) — collapsing the two would tell a
     * customer their product is quieter than it is. */
    stopReason: text("stop_reason", { enum: ANALYSIS_STOP_REASONS }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    /** Nullable ONLY pre-terminal — see the header. */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Model calls this run attempted. Not the cap ledger — see the header. */
    modelCallsAttempted: integer("model_calls_attempted").default(0).notNull(),
    /** Candidates the deterministic floor could not write up, so no finding row
     * exists for them. See the header — this is the count, never a sentence. */
    candidatesUnrenderable: integer("candidates_unrenderable").default(0).notNull(),
    /** Candidates the surface gate refused before the ladder began, so nothing
     * was claimed, sent or written for them. Kept apart from
     * `candidates_unrenderable` — see the header. */
    candidatesRefused: integer("candidates_refused").default(0).notNull(),
    /** Null ONLY where no call was attempted at all — never where one failed. */
    resolvedModelId: text("resolved_model_id"),
    /** Run-level aggregates. Null = NOT REPORTED, never `0`. */
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    /** Plain English, customer-readable. Never the vendor's own error text
     * verbatim (`packages/shared/src/summary/types.ts:146-152`) and never any
     * key material. */
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // THE single-writer-per-project lock (AD-4, D6). See the header: cap
    // exactness rests on this index, not on the count subquery.
    uniqueIndex("analysis_runs_one_open_per_project_key")
      .on(table.organizationId, table.projectId)
      .where(sql`${table.status} = 'running'`),
    // Every read in this lane names `organization_id` first (D7).
    index("analysis_runs_organization_id_idx").on(table.organizationId),
    // "What happened on this project's recent runs?" — org + project + recency.
    index("analysis_runs_org_project_started_at_idx").on(
      table.organizationId,
      table.projectId,
      table.startedAt,
    ),
  ],
);
