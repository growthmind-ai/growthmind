// Repository for `analysis_runs` and its cap-claim ledger `analysis_model_calls`.
//
// Org scope comes from the context, and from nowhere else `createAnalysisRunsRepo(db,
// ctx)`, the `deliveries.repo.ts` shape. No method takes an organization id. There is
// no id-only write path onto either table. The writer is a Graphile Worker task running
// with no user, so the explicit `organization_id` predicate on every statement here IS
// the whole tenant boundary for this lane, and no system/bypass context is reachable
// from this file. In the cap claim a dropped org predicate is invisible in the return
// value. A widened count simply spends another org's budget without erroring, which is
// why each of the claim's two count subqueries names its scoping columns out loud. The
// organisation-wide one is a hand-written aggregation and inherits nothing from the
// statement around it.
//
// Three answers that must never collapse `claimModelCall` returns `{claimed:true}`,
// `cap_exhausted`, or `already_claimed`. A retry reading as `cap_exhausted` would make
// an ordinary Graphile Worker replay look like an over-spend; a spent cap reading as
// `already_claimed` would send the lane looking for a finding nobody wrote. Three, not
// four: the per-project and the organisation-wide ceilings both answer `cap_exhausted`,
// because the lane renders one sentence for both and an answer nothing downstream can
// say out loud is one that only rots.
//
// Enums are parsed before the write `status` / `outcome` / `stop_reason` go through the
// shared Zod unions first, so a member forged past the types at runtime is refused at
// the wire rather than persisted as a state no message table has a sentence for.
//
// A run is finished once, and a run is not owned forever Two properties this file must
// hold that the partial unique index alone does not give it, both of them lifecycle
// rather than tenancy:
//
// `close` narrows on `status = 'running'` (the `poll-runs.repo.ts:161-169` predicate,
// same reason): a terminal row rewritten is an audit trail that lies in the one
// direction that matters. A run that in fact produced findings re-reported as a
// failure, or the reverse.
//
// `open` leases the lane rather than granting it indefinitely. The index means one
// `running` row blocks every future run for that project, and the comment this file
// used to carry. "the only path that can leave a `running` row is a close that itself
// fails". Was wrong. A sigkill, an oom kill, a container restart or a deploy between
// `open` and `close` each leave the row with nobody left to close it, and Graphile
// Worker's job-level retry does not help because the run row is not the job. Without a
// lease the next tick takes the `opened:false` arm forever: a permanent, silent,
// per-project denial of analysis caused by an ordinary process kill. See
// `ANALYSIS_RUN_LEASE_MS`.
import { randomUUID } from "node:crypto";

import {
  ANALYSIS_RUN_STATUS_MESSAGES,
  analysisOutcomeSchema,
  analysisRunStatusSchema,
  analysisStopReasonSchema,
  type AnalysisOutcome,
  type AnalysisRunStatus,
  type AnalysisStopReason,
  type TenantContext,
} from "@growthmind/shared";
import { and, eq, lt, sql } from "drizzle-orm";

import { analysisModelCalls } from "../schema/analysis-model-calls";
import { analysisRuns } from "../schema/analysis-runs";
import { projects } from "../schema/projects";
import type { ScopedDb } from "./types";

export type AnalysisRunRecord = typeof analysisRuns.$inferSelect;

/**
 * How long a `running` run is believed to still be running, 45 minutes.
 *
 * Past this, `open` treats the row as abandoned rather than live and reclaims it (see
 * `open`). The number sits between two bounds, and both of them are the reason it is 45
 * and not something rounder:
 *
 * Floor, comfortably longer than the worst realistic tick. A tick makes at most
 * `COLDSTART_MODEL_CALL_CAP` model calls (twelve, `worker/src/analysis-cap.ts`), each
 * individually deadline-bounded, plus its corpus reads and writes. That is minutes, not
 * tens of minutes, and 45 leaves better than a 2x margin. Set this too low and the
 * lease does the thing it exists to prevent: it steals a live run from itself, and two
 * workers then write one project's lane while the cap's count subquery still assumes a
 * single writer.
 *
 * Ceiling, strictly shorter than the analysis tick's cron period, which is hourly
 * (`worker/src/index.ts`, `0 * * * *`). That is what makes recovery cost exactly one
 * skipped check: a run abandoned at 09:05 is 55 minutes old when the 10:00 tick
 * arrives, so that tick reclaims it and opens its own run in the same pass. A lease of
 * an hour or more would land on the boundary and push recovery out to the tick after.
 * An extra hour of silence bought for nothing.
 *
 * It is a judgement, like the cap, and deliberately cheap to revisit: if the per-call
 * deadline or the cron period moves, this number is re-derived from the two bounds
 * above, in this one place.
 */
export const ANALYSIS_RUN_LEASE_MS = 45 * 60 * 1000;

/**
 * What a reclaimed run says happened.
 *
 * Imported, never authored here. `failure_reason` is read by a person, and every
 * customer-facing sentence in this lane has one home in `@growthmind/shared`'s message
 * tables. A second copy written into a data-access layer is how that rule dies quietly.
 *
 * `ANALYSIS_RUN_STATUS_MESSAGES.failed` is the honest sentence for this exact situation
 * and not a near-enough substitute: "Something went wrong partway through this check,
 * and we could not finish it. We will try again on the next check." A worker killed
 * mid-run went wrong partway through, did not finish, and (because the reclaim frees
 * the lane) genuinely is retried on the next check. It is also the same sentence the
 * lane writes when it closes a run `failed` itself
 * (`worker/src/tasks/analysis-tick.ts`), which is right: from the reader's side these
 * are one situation, not two.
 */
const ABANDONED_RUN_FAILURE_REASON: string = ANALYSIS_RUN_STATUS_MESSAGES.failed;

export interface OpenRunInput {
  readonly projectId: string;
  /** Also the lease clock. The reclaim cutoff below is measured back from this moment,
   * not from `Date.now`, so the decision is a pure function of the caller's tick time
   * and a test can age a run without sleeping. */
  readonly tickAt: Date;
}

/**
 * The answer to "is this run mine?".
 *
 * `opened: true` means this caller inserted the `running` row and is the single writer
 * for this project. `opened: false` means a run was already open and `run` carries it.
 * The partial unique index `analysis_runs_one_open_per_project_key` refused the second
 * insert, which is precisely the single-writer guarantee the cap's count subquery rests
 * on.
 *
 * `run` is present on both arms deliberately: every caller needs a run id to proceed,
 * and an optional run would push a null check into the lane where the honest answer is
 * always "here is the open run".
 */
export type OpenRunResult = {
  readonly opened: boolean;
  readonly run: AnalysisRunRecord;
};

export interface CloseRunInput {
  readonly runId: string;
  /** Narrows the update alongside the org predicate. A terminal write for a run
   * belonging to another project is not found, not written. */
  readonly projectId: string;
  readonly status: AnalysisRunStatus;
  readonly outcome: AnalysisOutcome;
  readonly stopReason: AnalysisStopReason;
  readonly finishedAt: Date;
  readonly modelCallsAttempted: number;
  /**
   * The candidates this run walked past, kept apart because they are different facts
   * (see `../schema/analysis-runs.ts`'s header): the floor could not phrase this one,
   * the surface gate would not transmit that one. Persisted as counts and never as a
   * sentence. A run where every candidate fell out must not close over zero findings
   * while reporting that it produced some and finished its list.
   */
  readonly candidatesUnrenderable: number;
  readonly candidatesRefused: number;
  /** Null only where no call was attempted at all in the whole run, never where one was
   * attempted and merely failed, and never where one threw: `modelCallsAttempted > 0`
   * with a null here is a shape the lane cannot produce
   * (`worker/src/tasks/analysis-tick.ts`, `CallAttribution`). */
  readonly resolvedModelId: string | null;
  /** Null = not reported, never `0`. */
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  /** Plain English, customer-readable; null on a `completed` run. Never the vendor's
   * own error text verbatim and never key material. */
  readonly failureReason: string | null;
}

export interface ClaimModelCallInput {
  readonly projectId: string;
  readonly runId: string;
  /** The finding's identity, the same value `findings.signature` carries for the same
   * problem, derived by the caller through the one producer `computeFindingSignature`.
   * This repository accepts it and never mints it, so the cap counts distinct problems
   * rather than distinct attempts. */
  readonly signature: string;
  /** Which tuple serialisation produced `signature`. Stored, not re-derived. */
  readonly signatureVersion: number;
  /**
   * The per-project ceiling. Worker policy, passed in, `packages/db` knows no cost
   * constant, and a cap baked in here would be a product decision buried in a
   * data-access layer (`worker/src/analysis-cap.ts`: `COLDSTART_MODEL_CALL_CAP`).
   */
  readonly projectCap: number;
  /**
   * The organisation-wide ceiling, counted across every project of the caller's
   * organisation (`worker/src/analysis-cap.ts`: `ORG_MODEL_CALL_CAP`).
   *
   * A second ceiling, not a second mechanism: it is one more conjunct on the same
   * conditional insert, and its refusal is the same `cap_exhausted` answer the
   * per-project ceiling gives. This repository does not report which of the two
   * refused, deliberately. The lane renders one sentence for both, and a distinction
   * nothing downstream can say out loud is a distinction that only rots. It is passed
   * in for `projectCap`'s reason: nothing here may decide how much an organisation is
   * allowed to spend.
   */
  readonly organizationCap: number;
  readonly at: Date;
}

export type ClaimModelCallResult =
  | { readonly claimed: true }
  | { readonly claimed: false; readonly reason: "cap_exhausted" }
  | { readonly claimed: false; readonly reason: "already_claimed" };

export interface AnalysisRunsRepo {
  /**
   * Insert a `running` run for this project, or hand back the one already open.
   *
   * The partial unique index (not a prior read) decides. A second concurrent run for a
   * project is un-insertable, so this never needs a "does one already exist?" check
   * that two callers could both pass.
   *
   * On the conflict path an incumbent older than `ANALYSIS_RUN_LEASE_MS` is reclaimed.
   * Closed `failed` / `fatal_error` and the insert retried, rather than believed. See
   * the implementation for why that is one statement.
   */
  open(input: OpenRunInput): Promise<OpenRunResult>;
  /**
   * The terminal write. Every exit path in the lane must reach one: a run left
   * `running` does not merely look untidy, it permanently jams the project's lane,
   * because the partial unique index means no later run can open while it stands.
   *
   * Narrowed to a run that is still `running`. Throws (it does not silently no-op) when
   * nothing matches, and after the lease that covers a new case beside "wrong org,
   * wrong project, wrong id": a worker returning late from a run another tick already
   * reclaimed. That caller's write is refused, which is the point; the reclaimed row is
   * the honest record and the late worker must not overwrite it with a verdict about a
   * lane it no longer holds. `worker/src/tasks/analysis-tick.ts`'s `closeRun` already
   * catches and logs every fault from this method rather than propagating it, so the
   * refusal costs one log line. No lane crashes, and no finding is lost, because
   * findings are persisted by `findings.repo.ts` before this is ever called.
   */
  close(input: CloseRunInput): Promise<AnalysisRunRecord>;
  /**
   * The atomic cap claim. One conditional insert, NO prior read, and two ceilings
   * inside it:
   *
   * Insert into analysis_model_calls
   *  SELECT … WHERE (SELECT count FROM analysis_model_calls c
   *  WHERE c.organization_id = $org
   *  And c.project_id = $project) < $projectCap
   *  AND (SELECT count FROM analysis_model_calls c
   *  Where c.organization_id = $org) < $organizationCap
   *  ON CONFLICT (organization_id, project_id, signature) DO NOTHING
   * Returning id
   *
   * The second conjunct is what makes the first a real ceiling: nothing limits how many
   * projects an organisation creates, so a per-project cap alone is a ceiling of
   * `projectCap × N` with no N. Both are evaluated inside the one statement, so adding
   * the organisation ceiling costs no atomicity. There is still no window in which two
   * callers can each conclude there is budget.
   *
   * A returned row means this caller owns the call. No row means one of the two
   * refusals, disambiguated by a scoped read of the same tuple after the write. That
   * read is not a check-then-write window: no model call is made on either branch of
   * it, and neither branch writes.
   *
   * The ordering matters and is the thing a naive implementation gets wrong. A repeat
   * claim while the cap is also spent must read `already_claimed`, because what refuses
   * it is the row that is already there, not a count predicate evaluated first. Asking
   * "does the tuple exist?" after the statement gets that right for free; branching on
   * the count before the insert gets it wrong every time.
   */
  claimModelCall(input: ClaimModelCallInput): Promise<ClaimModelCallResult>;
}

/** Minimal structural view of the two drivers' `execute`. `ScopedDb` is a union of
 * `NodePgDatabase` and `PgliteDatabase`, whose `execute` signatures are parameterized
 * on different query-result HKTs and so are not callable through the union. Both really
 * do return `{ rows }`; this names that shared shape rather than widening the db
 * parameter to `any`. */
type RawExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
};

export function createAnalysisRunsRepo(db: ScopedDb, ctx: TenantContext): AnalysisRunsRepo {
  /** The lane's entire tenant boundary, written once so no statement below can be
   * refactored into one that forgot it. Every read and every write on `analysis_runs`
   * in this file begins with this predicate. */
  const ownedByCallerOrg = () => eq(analysisRuns.organizationId, ctx.organizationId);

  /**
   * `project_id` is client-supplied, and the org column alone does not constrain it.
   * Opening a run against another org's project would stamp our org onto their product,
   * and, worse, would occupy a lane slot neither org can account for. A project's
   * owning organization is immutable, so this guard is not the check-then-write hazard:
   * the answer cannot change between this read and the write.
   */
  async function assertProjectIsOurs(projectId: string): Promise<void> {
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.id, projectId)))
      .limit(1);

    if (!owned) {
      throw new Error("analysis_runs: the project named is not this organization's");
    }
  }

  /** The insert, on its own, so `open` can run it twice. Once cold, and once more after
   * a reclaim freed the lane, without the second attempt being a copy of the first that
   * could drift from it. */
  async function insertRunningRun(input: OpenRunInput): Promise<AnalysisRunRecord | undefined> {
    // One statement. The conflict target is the partial index, so the `targetWhere`
    // must repeat its predicate exactly or Postgres will not match the index at all.
    const [inserted] = await db
      .insert(analysisRuns)
      .values({
        organizationId: ctx.organizationId,
        projectId: input.projectId,
        status: "running",
        startedAt: input.tickAt,
      })
      .onConflictDoNothing({
        target: [analysisRuns.organizationId, analysisRuns.projectId],
        // Drizzle spells the arbiter index predicate `where` on `onConflictDoNothing`
        // (it is `targetWhere` only on the do update form). It must repeat the partial
        // index's predicate verbatim, or Postgres cannot infer the index and refuses
        // the statement outright.
        where: sql`${analysisRuns.status} = 'running'`,
      })
      .returning();

    return inserted;
  }

  /**
   * Reclaim an abandoned run. The lease, and the whole answer to "who closes the run
   * when the process that opened it is killed?".
   *
   * One conditional update, never check-then-write. The staleness test (`status =
   * 'running' AND started_at < cutoff`) lives inside the statement's own where clause,
   * so two workers arriving on the same stale row cannot both conclude "this one is
   * abandoned, it is mine to close": the second blocks on the row lock, re-reads the
   * row Postgres has by then updated, finds `status = 'running'` false, and matches
   * zero rows. Exactly one caller gets a `RETURNING` row, which is what makes "did I
   * reclaim it?" a fact rather than a guess. Reading the row first and updating it
   * after would put a window between the two where both callers are still looking at
   * `running`.
   *
   * Terminal, not deleted, and not re-opened. The abandoned run is written `failed` /
   * `fatal_error` with a plain-English reason. Deleting it would erase the evidence
   * that a check was attempted at all; re-opening it (or closing it `completed`) would
   * report a run that never finished as one that did. A reclaim IS an exit path, so it
   * records a terminal state like every other exit path in this lane.
   *
   * `outcome` is deliberately left NULL, matching the failed arm of
   * `poll-runs.repo.ts:137-144`. All three members of `AnalysisOutcome` are claims
   * about what a check found, and nobody observed this one's answer:
   * `produced_findings` would invent a finding, and either `no_*` member would report
   * the shape of an empty product for a run that simply died. The exact false
   * reassurance SAC-10 exists to prevent. Silence about an unobserved fact is the
   * honest record; `status` and `stop_reason` carry the whole story.
   *
   * @returns `true` when this caller reclaimed the stale run.
   */
  async function reclaimAbandonedRun(input: OpenRunInput): Promise<boolean> {
    const cutoff = new Date(input.tickAt.getTime() - ANALYSIS_RUN_LEASE_MS);

    // Literals, and parsed anyway. The rule in this file is that nothing reaches these
    // columns without passing the shared union first, and an exception carved out
    // "because this one is a literal" is how a total rule becomes a mostly-true one.
    // Cheap, and it runs only on a reclaim.
    const status = analysisRunStatusSchema.parse("failed");
    const stopReason = analysisStopReasonSchema.parse("fatal_error");

    const [reclaimed] = await db
      .update(analysisRuns)
      .set({
        status,
        stopReason,
        // When we declared it abandoned, not when the worker died. That moment is
        // unknowable by construction, and inventing a plausible one would be a
        // fabricated timestamp in an audit trail.
        finishedAt: input.tickAt,
        failureReason: ABANDONED_RUN_FAILURE_REASON,
      })
      .where(
        and(
          ownedByCallerOrg(),
          eq(analysisRuns.projectId, input.projectId),
          // Both halves are the condition, not a pre-check: dropping either one turns
          // this into an unconditional overwrite of somebody's live run.
          eq(analysisRuns.status, "running"),
          lt(analysisRuns.startedAt, cutoff),
        ),
      )
      // Bare, not a projection: `ScopedDb` is a union of two drivers whose `returning`
      // overloads are parameterized on different query-result HKTs, so the column-list
      // form is not callable through the union. `close` and the insert above take the
      // same shape for the same reason.
      .returning();

    return reclaimed !== undefined;
  }

  return {
    async open(input: OpenRunInput): Promise<OpenRunResult> {
      await assertProjectIsOurs(input.projectId);

      const inserted = await insertRunningRun(input);

      if (inserted) {
        return { opened: true, run: inserted };
      }

      // A run was already open. Before believing it is live, ask whether it is merely
      // old: nothing outside this file ever closes an abandoned row, and there is no
      // reaper.
      if (await reclaimAbandonedRun(input)) {
        // The lane is free and this caller is the one that freed it. Retry once. A
        // second caller that lost the reclaim race may already have inserted its own
        // run in the gap, in which case this conflicts again and falls through to the
        // read below, `opened: false` against a genuinely live run, which is the
        // correct answer.
        const afterReclaim = await insertRunningRun(input);

        if (afterReclaim) {
          return { opened: true, run: afterReclaim };
        }
      }

      // We lost the race, or a run was already open and still within its lease. Read
      // the incumbent under our org. The conflicting row is ours by construction.
      const [existing] = await db
        .select()
        .from(analysisRuns)
        .where(
          and(
            ownedByCallerOrg(),
            eq(analysisRuns.projectId, input.projectId),
            eq(analysisRuns.status, "running"),
          ),
        )
        .limit(1);

      if (!existing) {
        // The row that blocked us is gone and nothing replaced it. The lease makes this
        // reachable rather than merely theoretical: a rival worker whose reclaim beat
        // ours commits the terminal write before it commits its own insert, and a read
        // landing in that gap sees an empty lane. So try once more before giving up. An
        // empty lane is a lane to take, and throwing here would deny a check over a
        // millisecond of timing.
        const afterRivalReclaim = await insertRunningRun(input);

        if (afterRivalReclaim) {
          return { opened: true, run: afterRivalReclaim };
        }

        // Still nothing, and still un-insertable: a shape this table cannot produce.
        // Loud, because "opened: false with no run" is a shape no caller can act on and
        // a silent return would jam the lane invisibly.
        throw new Error("analysis_runs: open conflicted but no running run was found");
      }

      return { opened: false, run: existing };
    },

    async close(input: CloseRunInput): Promise<AnalysisRunRecord> {
      // Parsed before the update, so a forged member leaves the row untouched.
      const status = analysisRunStatusSchema.parse(input.status);
      const outcome = analysisOutcomeSchema.parse(input.outcome);
      const stopReason = analysisStopReasonSchema.parse(input.stopReason);

      const [row] = await db
        .update(analysisRuns)
        .set({
          status,
          outcome,
          stopReason,
          finishedAt: input.finishedAt,
          modelCallsAttempted: input.modelCallsAttempted,
          // The candidates that produced no finding. Written here so the fact outlives
          // the process that counted it. In memory it dies with the tick, and the run
          // then reports a clean list it did not finish.
          candidatesUnrenderable: input.candidatesUnrenderable,
          candidatesRefused: input.candidatesRefused,
          resolvedModelId: input.resolvedModelId,
          // Never `?? 0`, null here means the run's calls went unmetered, not that the
          // run was free.
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          failureReason: input.failureReason,
        })
        .where(
          and(
            ownedByCallerOrg(),
            eq(analysisRuns.projectId, input.projectId),
            eq(analysisRuns.id, input.runId),
            // A run is finished once (`poll-runs.repo.ts:161-169`). Without this a
            // terminal row can be rewritten, and the rewrite is always the
            // less-informed verdict overwriting the better-informed one: a run that
            // produced findings re-reported as a failure, or a run this lane already
            // reclaimed as abandoned re-reported by its late original worker as a clean
            // `completed`. The audit trail then lies in the one direction that matters.
            eq(analysisRuns.status, "running"),
          ),
        )
        .returning();

      if (!row) {
        // Nothing matched, a run of another org or project, an id that does not exist,
        // or a run that is already terminal (closed twice, or reclaimed by a later tick
        // while this worker was still going). Loud rather than silent in every one of
        // those cases: the first three each mean a `running` row somewhere is being
        // left to jam its lane, and the caller cannot tell which case it hit without
        // being told something went wrong. `analysis-tick.ts`'s `closeRun` catches this
        // and logs it, so the throw never propagates into a lane or costs a finding.
        throw new Error(
          "analysis_runs: no run of this organization was still open to match the close",
        );
      }

      return row;
    },

    async claimModelCall(input: ClaimModelCallInput): Promise<ClaimModelCallResult> {
      const id = randomUUID();
      // One statement. The two count subqueries decide the two ceilings and the unique
      // index decides the retry; nothing is read first, so no two callers can both
      // conclude "there is budget, and this candidate is unclaimed".
      const result = await (db as unknown as RawExecutor).execute(sql`
        insert into analysis_model_calls
          (id, organization_id, project_id, run_id, signature, signature_version, attempted_at)
        select
          ${id},
          ${ctx.organizationId},
          ${input.projectId},
          ${input.runId},
          ${input.signature},
          ${input.signatureVersion},
          ${input.at}
        where exists (
          -- The project must be OURS. Folded into the same statement rather
          -- than read first, so the claim stays one statement with no prior
          -- read (AD-4). A caller naming another org's project consumes no
          -- budget — ours or theirs — and mints no row.
          select 1 from projects p
           where p.id = ${input.projectId}
             and p.organization_id = ${ctx.organizationId}
        )
        and (
          -- CEILING 1, PER PROJECT. Both scoping columns named out loud: a
          -- dropped org predicate here is invisible in the return value,
          -- because a widened count simply spends another org's budget
          -- without erroring.
          select count(*) from analysis_model_calls c
           where c.organization_id = ${ctx.organizationId}
             and c.project_id = ${input.projectId}
        ) < ${input.projectCap}
        and (
          -- CEILING 2, PER ORGANISATION (AD-23). A HAND-WRITTEN AGGREGATION,
          -- so it names the caller's own organization id ITSELF — nothing
          -- about sitting inside a scoped repository's statement gives a
          -- subquery tenancy (D7). Without that column the count would be
          -- every organisation's claims summed, and one customer's spending
          -- would refuse another's claims. The project is deliberately NOT
          -- named: this ceiling is the sum across every project the
          -- organisation has, which is the whole point of it.
          select count(*) from analysis_model_calls c
           where c.organization_id = ${ctx.organizationId}
        ) < ${input.organizationCap}
        on conflict (organization_id, project_id, signature) do nothing
        returning id
      `);

      if (result.rows.length > 0) {
        return { claimed: true };
      }

      // Which refusal? Ask whether the tuple exists, never whether the cap is spent. A
      // repeat claim while the cap is also spent is still a retry, and this ordering is
      // what keeps the two answers from collapsing.
      const [existing] = await db
        .select({ id: analysisModelCalls.id })
        .from(analysisModelCalls)
        .where(
          and(
            eq(analysisModelCalls.organizationId, ctx.organizationId),
            eq(analysisModelCalls.projectId, input.projectId),
            eq(analysisModelCalls.signature, input.signature),
          ),
        )
        .limit(1);

      return existing
        ? { claimed: false, reason: "already_claimed" }
        : { claimed: false, reason: "cap_exhausted" };
    },
  };
}
