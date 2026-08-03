import type { OnboardingFinding, StagePersistedFacts, TenantContext } from "@growthmind/shared";
import { logger, onboardingFindingSchema } from "@growthmind/shared";
import { asc, eq, gt, gte } from "drizzle-orm";

import { createFindingsRepo } from "../repositories/findings.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { analysisRuns } from "../schema/analysis-runs";
import { firstRunState } from "../schema/first-run-state";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";

export interface FirstRunStatusService {
  read(projectId: string): Promise<StagePersistedFacts>;
}

const NO_FACTS = {
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
} as const;

async function readNewestFinding(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<OnboardingFinding | null> {
  let record;
  try {
    [record] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
  } catch (error) {
    logger.error("first-run status: could not read the newest finding for the project", {
      organizationId: ctx.organizationId,
      projectId,
      error,
    });
    return null;
  }

  if (!record) {
    return null;
  }

  const parsed = onboardingFindingSchema.safeParse({
    finalClass: record.finalClass,
    headline: record.headline,
    context: record.context,

    counts: record.counts.map((count) => ({
      numerator: count.numerator,
      denominator: count.denominator,
      unit: count.unit,
    })),
    surface: record.surface,
    confidenceBasis: record.confidenceBasis,
    windowStart: record.windowStart,
    windowEnd: record.windowEnd,
    summarySource: record.summarySource,
  });

  if (!parsed.success) {
    logger.error("first-run status: the newest finding did not satisfy the rendered shape", {
      organizationId: ctx.organizationId,
      projectId,
      findingId: record.id,
      issues: parsed.error.issues,
    });
    return null;
  }

  return parsed.data;
}

export function createFirstRunStatusService(
  db: ScopedDb,
  ctx: TenantContext,
): FirstRunStatusService {
  const s = scoped(db, ctx);

  return {
    async read(projectId: string): Promise<StagePersistedFacts> {
      const [state] = await db
        .select({ armedAt: firstRunState.armedAt })
        .from(firstRunState)
        .where(s.owned(firstRunState, eq(firstRunState.projectId, projectId)))
        .limit(1);

      const armedAt = state?.armedAt ?? null;
      const finding = await readNewestFinding(db, ctx, projectId);

      if (armedAt === null) {
        return { ...NO_FACTS, finding };
      }

      const [retrieved] = await db
        .select({ finishedAt: sessionSourcePollRuns.finishedAt })
        .from(sessionSourcePollRuns)
        .where(
          s.owned(
            sessionSourcePollRuns,
            eq(sessionSourcePollRuns.projectId, projectId),
            eq(sessionSourcePollRuns.status, "completed"),
            gt(sessionSourcePollRuns.eventsPersisted, 0),
            gte(sessionSourcePollRuns.finishedAt, armedAt),
          ),
        )
        .orderBy(asc(sessionSourcePollRuns.finishedAt))
        .limit(1);

      const [run] = await db
        .select({
          startedAt: analysisRuns.startedAt,
          finishedAt: analysisRuns.finishedAt,
          status: analysisRuns.status,
          outcome: analysisRuns.outcome,
        })
        .from(analysisRuns)
        .where(
          s.owned(
            analysisRuns,
            eq(analysisRuns.projectId, projectId),
            gte(analysisRuns.startedAt, armedAt),
          ),
        )
        .orderBy(asc(analysisRuns.startedAt))
        .limit(1);

      return {
        armedAt,
        retrievedAt: retrieved?.finishedAt ?? null,
        readingAt: run?.startedAt ?? null,

        endedAt: run?.finishedAt ?? null,
        runStatus: run?.status ?? null,
        runOutcome: run?.outcome ?? null,
        finding,
      };
    },
  };
}
