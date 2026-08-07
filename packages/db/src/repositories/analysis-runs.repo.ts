import { randomUUID } from "node:crypto";

import {
  ANALYSIS_RUN_STATUS_MESSAGES,
  analysisOutcomeSchema,
  analysisRunStatusSchema,
  analysisStopReasonSchema,
  type AnalysisOutcome,
  type AnalysisRunStatus,
  type AnalysisStopReason,
  type ModelCallStage,
  type TenantContext,
} from "@growthmind/shared";
import { eq, lt, sql } from "drizzle-orm";

import { publishLive } from "../live/publish";
import { analysisModelCalls } from "../schema/analysis-model-calls";
import { analysisRuns } from "../schema/analysis-runs";
import { orgCrud } from "./crud";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

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
  readonly stage: ModelCallStage;
}

export type ClaimModelCallResult =
  | { readonly claimed: true }
  | { readonly claimed: false; readonly reason: "cap_exhausted" }
  | { readonly claimed: false; readonly reason: "already_claimed" };

export interface AnalysisRunsRepo {
  open(input: OpenRunInput): Promise<OpenRunResult>;

  close(input: CloseRunInput): Promise<AnalysisRunRecord>;

  claimModelCall(input: ClaimModelCallInput): Promise<ClaimModelCallResult>;

  // The last N runs that reached an end, newest first — `running` excluded, because a run
  // still in flight is not evidence either way. The org filter is repo-injected.
  recentTerminalStatuses(projectId: string, limit: number): Promise<readonly AnalysisRunStatus[]>;
}

type RawExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
};

const notOurProject = (): Error =>
  new Error("analysis_runs: the project named is not this organization's");

export function createAnalysisRunsRepo(db: ScopedExecutor, ctx: TenantContext): AnalysisRunsRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, analysisRuns);

  // These rows are two of the setup screen's steps — `reading` while a run is open, `ended`
  // when it closes with no finding. Nothing else publishes them, and the screen has no timer
  // left to notice on its own (D11).
  async function announce(): Promise<void> {
    await publishLive(db, { organizationId: ctx.organizationId, topic: "first_run" });
  }

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

    const reclaimed = await c.update(
      {
        status,
        stopReason,

        finishedAt: input.tickAt,
        failureReason: ABANDONED_RUN_FAILURE_REASON,
      },
      eq(analysisRuns.projectId, input.projectId),
      eq(analysisRuns.status, "running"),
      lt(analysisRuns.startedAt, cutoff),
    );

    return reclaimed !== null;
  }

  return {
    async open(input: OpenRunInput): Promise<OpenRunResult> {
      await s.assertProjectOwned(input.projectId, notOurProject);

      const inserted = await insertRunningRun(input);

      if (inserted) {
        await announce();
        return { opened: true, run: inserted };
      }

      if (await reclaimAbandonedRun(input)) {
        const afterReclaim = await insertRunningRun(input);

        if (afterReclaim) {
          await announce();
          return { opened: true, run: afterReclaim };
        }
      }

      const existing = await c.maybe(
        eq(analysisRuns.projectId, input.projectId),
        eq(analysisRuns.status, "running"),
      );

      if (!existing) {
        const afterRivalReclaim = await insertRunningRun(input);

        if (afterRivalReclaim) {
          await announce();
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

      const row = await c.update(
        {
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
        },
        eq(analysisRuns.projectId, input.projectId),
        eq(analysisRuns.id, input.runId),
        eq(analysisRuns.status, "running"),
      );

      if (!row) {
        throw new Error(
          "analysis_runs: no run of this organization was still open to match the close",
        );
      }

      await announce();

      return row;
    },

    async claimModelCall(input: ClaimModelCallInput): Promise<ClaimModelCallResult> {
      const id = randomUUID();

      const result = await (db as unknown as RawExecutor).execute(sql`
        insert into analysis_model_calls
          (id, organization_id, project_id, run_id, signature, signature_version, attempted_at, stage)
        select
          ${id},
          ${ctx.organizationId},
          ${input.projectId},
          ${input.runId},
          ${input.signature},
          ${input.signatureVersion},
          ${input.at},
          ${input.stage}
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
          -- without erroring. Counted across BOTH stages (ADD Decision 2) —
          -- this ceiling answers "how much has this project spent," and
          -- spend is stage-agnostic; a stage filter here would let the cause
          -- stage double the effective project cap.
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
          -- organisation has, which is the whole point of it. Also counted
          -- across both stages, same reasoning as CEILING 1.
          select count(*) from analysis_model_calls c
           where c.organization_id = ${ctx.organizationId}
        ) < ${input.organizationCap}
        on conflict (organization_id, project_id, signature, stage) do nothing
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
              eq(analysisModelCalls.stage, input.stage),
            ),
          )
          .limit(1),
      );

      return existing
        ? { claimed: false, reason: "already_claimed" }
        : { claimed: false, reason: "cap_exhausted" };
    },

    recentTerminalStatuses(
      _projectId: string,
      _limit: number,
    ): Promise<readonly AnalysisRunStatus[]> {
      throw new Error("O-051 job 2: not implemented");
    },
  };
}
