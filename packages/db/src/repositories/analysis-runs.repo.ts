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
import { eq, lt, sql } from "drizzle-orm";

import { analysisModelCalls } from "../schema/analysis-model-calls";
import { analysisRuns } from "../schema/analysis-runs";
import { scoped } from "./scope";
import type { ScopedDb } from "./types";

export type AnalysisRunRecord = typeof analysisRuns.$inferSelect;

export const ANALYSIS_RUN_LEASE_MS = 45 * 60 * 1000;

const ABANDONED_RUN_FAILURE_REASON: string = ANALYSIS_RUN_STATUS_MESSAGES.failed;

export interface OpenRunInput {
  readonly projectId: string;

  readonly tickAt: Date;
}

export type OpenRunResult = {
  readonly opened: boolean;
  readonly run: AnalysisRunRecord;
};

export interface CloseRunInput {
  readonly runId: string;

  readonly projectId: string;
  readonly status: AnalysisRunStatus;
  readonly outcome: AnalysisOutcome;
  readonly stopReason: AnalysisStopReason;
  readonly finishedAt: Date;
  readonly modelCallsAttempted: number;

  readonly candidatesUnrenderable: number;
  readonly candidatesRefused: number;

  readonly resolvedModelId: string | null;

  readonly tokensIn: number | null;
  readonly tokensOut: number | null;

  readonly failureReason: string | null;
}

export interface ClaimModelCallInput {
  readonly projectId: string;
  readonly runId: string;

  readonly signature: string;

  readonly signatureVersion: number;

  readonly projectCap: number;

  readonly organizationCap: number;
  readonly at: Date;
}

export type ClaimModelCallResult =
  | { readonly claimed: true }
  | { readonly claimed: false; readonly reason: "cap_exhausted" }
  | { readonly claimed: false; readonly reason: "already_claimed" };

export interface AnalysisRunsRepo {
  open(input: OpenRunInput): Promise<OpenRunResult>;

  close(input: CloseRunInput): Promise<AnalysisRunRecord>;

  claimModelCall(input: ClaimModelCallInput): Promise<ClaimModelCallResult>;
}

type RawExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
};

const notOurProject = (): Error =>
  new Error("analysis_runs: the project named is not this organization's");

export function createAnalysisRunsRepo(db: ScopedDb, ctx: TenantContext): AnalysisRunsRepo {
  const s = scoped(db, ctx);

  async function insertRunningRun(input: OpenRunInput): Promise<AnalysisRunRecord | undefined> {
    const [inserted] = await db
      .insert(analysisRuns)
      .values({
        ...s.stamp,
        projectId: input.projectId,
        status: "running",
        startedAt: input.tickAt,
      })
      .onConflictDoNothing({
        target: [analysisRuns.organizationId, analysisRuns.projectId],

        where: sql`${analysisRuns.status} = 'running'`,
      })
      .returning();

    return inserted;
  }

  async function reclaimAbandonedRun(input: OpenRunInput): Promise<boolean> {
    const cutoff = new Date(input.tickAt.getTime() - ANALYSIS_RUN_LEASE_MS);

    const status = analysisRunStatusSchema.parse("failed");
    const stopReason = analysisStopReasonSchema.parse("fatal_error");

    const [reclaimed] = await db
      .update(analysisRuns)
      .set({
        status,
        stopReason,

        finishedAt: input.tickAt,
        failureReason: ABANDONED_RUN_FAILURE_REASON,
      })
      .where(
        s.owned(
          analysisRuns,
          eq(analysisRuns.projectId, input.projectId),

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
      await s.assertProjectOwned(input.projectId, notOurProject);

      const inserted = await insertRunningRun(input);

      if (inserted) {
        return { opened: true, run: inserted };
      }

      if (await reclaimAbandonedRun(input)) {
        const afterReclaim = await insertRunningRun(input);

        if (afterReclaim) {
          return { opened: true, run: afterReclaim };
        }
      }

      const existing = s.maybe(
        await db
          .select()
          .from(analysisRuns)
          .where(
            s.owned(
              analysisRuns,
              eq(analysisRuns.projectId, input.projectId),
              eq(analysisRuns.status, "running"),
            ),
          )
          .limit(1),
      );

      if (!existing) {
        const afterRivalReclaim = await insertRunningRun(input);

        if (afterRivalReclaim) {
          return { opened: true, run: afterRivalReclaim };
        }

        throw new Error("analysis_runs: open conflicted but no running run was found");
      }

      return { opened: false, run: existing };
    },

    async close(input: CloseRunInput): Promise<AnalysisRunRecord> {
      const status = analysisRunStatusSchema.parse(input.status);
      const outcome = analysisOutcomeSchema.parse(input.outcome);
      const stopReason = analysisStopReasonSchema.parse(input.stopReason);

      const row = s.maybe(
        await db
          .update(analysisRuns)
          .set({
            status,
            outcome,
            stopReason,
            finishedAt: input.finishedAt,
            modelCallsAttempted: input.modelCallsAttempted,

            candidatesUnrenderable: input.candidatesUnrenderable,
            candidatesRefused: input.candidatesRefused,
            resolvedModelId: input.resolvedModelId,

            tokensIn: input.tokensIn,
            tokensOut: input.tokensOut,
            failureReason: input.failureReason,
          })
          .where(
            s.owned(
              analysisRuns,
              eq(analysisRuns.projectId, input.projectId),
              eq(analysisRuns.id, input.runId),

              eq(analysisRuns.status, "running"),
            ),
          )
          .returning(),
      );

      if (!row) {
        throw new Error(
          "analysis_runs: no run of this organization was still open to match the close",
        );
      }

      return row;
    },

    async claimModelCall(input: ClaimModelCallInput): Promise<ClaimModelCallResult> {
      const id = randomUUID();

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

      const existing = s.maybe(
        await db
          .select({ id: analysisModelCalls.id })
          .from(analysisModelCalls)
          .where(
            s.owned(
              analysisModelCalls,
              eq(analysisModelCalls.projectId, input.projectId),
              eq(analysisModelCalls.signature, input.signature),
            ),
          )
          .limit(1),
      );

      return existing
        ? { claimed: false, reason: "already_claimed" }
        : { claimed: false, reason: "cap_exhausted" };
    },
  };
}
