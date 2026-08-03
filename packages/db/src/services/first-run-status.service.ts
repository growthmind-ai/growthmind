import type { OnboardingFinding, StagePersistedFacts, TenantContext } from "@growthmind/shared";
import { logger, onboardingFindingSchema } from "@growthmind/shared";
import { asc, eq, gt, gte } from "drizzle-orm";

import { describeDriverError } from "../repositories/driver-error";
import { createFindingsRepo } from "../repositories/findings.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { analysisRuns } from "../schema/analysis-runs";
import { firstRunState } from "../schema/first-run-state";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";

// Three facts about ONE row, from ONE read. The card, the delivery line and the fault
// sentence each used to run a bounded finding read of their own; during onboarding the
// analysis lane persists findings in a sequential loop, so a newer row landing between
// two of them gave one finding card the next finding delivery state (B-038).
export interface FirstRunStatusFacts extends StagePersistedFacts {
  readonly findingId: string | null;

  // A row is there and did not satisfy the rendered shape — which is why this is
  // not simply `finding === null`.
  readonly findingUnavailable: boolean;
}

export interface FirstRunStatusService {
  read(projectId: string): Promise<FirstRunStatusFacts>;
}

const NO_FACTS = {
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
} as const;

interface NewestFinding {
  readonly id: string | null;
  readonly finding: OnboardingFinding | null;
  readonly unavailable: boolean;
}

// Absent and unreadable are different answers, and the screen says different things.
const NO_FINDING: NewestFinding = { id: null, finding: null, unavailable: false };
const UNREADABLE: NewestFinding = { id: null, finding: null, unavailable: true };

async function readNewestFinding(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<NewestFinding> {
  let record;
  try {
    [record] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
  } catch (error) {
    // `describeDriverError`, never the caught value: a failed query's own message IS
    // the statement and its bound parameters. Both deleted readers said so; this is
    // now the only one left, so it has to.
    logger.error("first-run status: could not read the newest finding for the project", {
      organizationId: ctx.organizationId,
      projectId,
      reason: describeDriverError(error),
    });
    return UNREADABLE;
  }

  if (!record) {
    return NO_FINDING;
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

    // UNREADABLE, not `{ id: record.id, … }`. Returning the id here would be the one
    // state where a delivery is correlated for a finding no screen can render — and
    // `finding === null` implying `findingId === null` is the invariant that makes
    // the card and the delivery line inseparable.
    return UNREADABLE;
  }

  return { id: record.id, finding: parsed.data, unavailable: false };
}

export function createFirstRunStatusService(
  db: ScopedDb,
  ctx: TenantContext,
): FirstRunStatusService {
  const s = scoped(db, ctx);

  return {
    async read(projectId: string): Promise<FirstRunStatusFacts> {
      const [state] = await db
        .select({ armedAt: firstRunState.armedAt })
        .from(firstRunState)
        .where(s.owned(firstRunState, eq(firstRunState.projectId, projectId)))
        .limit(1);

      const armedAt = state?.armedAt ?? null;
      const newest = await readNewestFinding(db, ctx, projectId);
      const found = {
        finding: newest.finding,
        findingId: newest.id,
        findingUnavailable: newest.unavailable,
      };

      if (armedAt === null) {
        return { ...NO_FACTS, ...found };
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
        ...found,
      };
    },
  };
}
