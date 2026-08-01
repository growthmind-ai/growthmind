// The one read that assembles `StagePersistedFacts` (O-008 AD-6, FR-O5/FR-O6).
//
// ── THIS FILE IS THE D11 ANSWER, AND WHAT IT ANSWERS IS AN ABSENCE ──────────
// D11's rule is that a value one surface COMPUTES and another surface CONSUMES
// dies silently the moment the wire between them is severed: the consumer reads
// an always-absent field, its "when present…" branch never runs, and every null
// check downstream reads the permanent absence as the legitimate no-signal
// case. Producer tests pass, consumer tests pass, the feature is inert.
//
// So THE CONSUMER DERIVES EVERY MILESTONE ITSELF, from rows that already exist.
// Nothing is minted, nothing is hand-passed, and there is no optional field for
// a later change to stop populating:
//
//   armedAt      -> first_run_state.armed_at (org+project)
//   retrievedAt  -> session_source_poll_runs: the earliest `finished_at` of a
//                   COMPLETED run that PERSISTED EVENTS at or after arming
//   readingAt    -> analysis_runs: the earliest `started_at` at or after arming
//   endedAt / runStatus / runOutcome -> THAT SAME analysis_runs row
//   finding      -> findings.listForProject(projectId, { limit: 1 })
//
// ── WHY THE TWO LEGS CANNOT COLLAPSE INTO ONE LINE ──────────────────────────
// They are written by TWO DIFFERENT PROCESSES INTO TWO DIFFERENT TABLES AT TWO
// GENUINELY DIFFERENT TIMES. `session-source-poll.ts` finishes a poll run when
// the third party's read side finally surfaces the event; `analysis-tick.ts`
// opens an analysis run when our own lane starts reading it. No single write
// produces both, and no new column was needed — `events_persisted` is already a
// non-null integer and `finished_at` is already distinct from `started_at`.
//
// `events_persisted > 0` is the discriminator, and it is not decoration: a run
// that completed having persisted nothing is a successful poll that found
// nothing, and telling a founder "your failed request reached us" on the
// strength of it is a claim we cannot support.
//
// ── THE DESIGNED OUT-OF-ORDER CASE ──────────────────────────────────────────
// `readingAt` CAN precede `retrievedAt` — the hourly analysis cron opens runs
// for reasons unrelated to the founder's trigger. Both are returned AS-IS. The
// two things this must never do are swap them so the story reads in the
// expected order, and null the earlier one because it "cannot" have happened —
// which would erase a milestone that genuinely did.
//
// ── A HAND-WRITTEN AGGREGATION INHERITS NOTHING (D7) ────────────────────────
// `ScopedDb` is a raw driver union: nothing injects an organization filter on a
// service's behalf. Every statement below names `ctx.organizationId` OUT LOUD,
// and a client-supplied project id belonging to another organization therefore
// resolves to nothing rather than to that organization's facts. This is the
// `events-counter.service.ts:68-75` discipline, copied rather than re-derived.
import type { OnboardingFinding, StagePersistedFacts, TenantContext } from "@growthmind/shared";
import { onboardingFindingSchema } from "@growthmind/shared";
import { and, asc, eq, gt, gte } from "drizzle-orm";

import { createFindingsRepo } from "../repositories/findings.repo";
import type { ScopedDb } from "../repositories/types";
import { analysisRuns } from "../schema/analysis-runs";
import { firstRunState } from "../schema/first-run-state";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";

export interface FirstRunStatusService {
  /**
   * Every fact the stage is derived from, for one project, in one read.
   *
   * A project with NO rows at all yields all-null facts and never a throw
   * (EC-O5) — that is the state a founder is in for the whole of steps 1 to 4,
   * which is most of the time anyone spends on this surface.
   */
  read(projectId: string): Promise<StagePersistedFacts>;
}

/** The all-null answer: never armed, nothing polled, nothing analysed. Written
 * once so the unarmed path and the empty-project path cannot drift apart. */
const NO_FACTS = {
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
} as const;

/**
 * The newest finding for this project, mapped to the shape the surface renders.
 *
 * THE BOUNDARY PARSE (D5). `FindingRecord` is a `packages/db` type carrying two
 * jsonb columns and `packages/shared` may not import `packages/db`, so the row
 * is mapped field-by-field into `OnboardingFinding` and VALIDATED here. Nothing
 * downstream re-casts and nothing downstream re-parses.
 *
 * A row that cannot be mapped degrades to `null` and says so in the log rather
 * than throwing (D8): this is the one screen the product exists for, and the
 * run's own terminal columns still render an honest ending beside the absence.
 * The failure is never silent — a catch with nothing in it is how a jsonb shape
 * that has drifted stays undiscovered.
 */
async function readNewestFinding(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<OnboardingFinding | null> {
  let record;
  try {
    // Org- AND project-scoped inside the repository, newest first.
    [record] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
  } catch (error) {
    console.error("first-run status: could not read the newest finding for the project", {
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
    // The persisted count carries a timeframe and a basis the surface does not
    // render. Dropped explicitly rather than by letting the schema strip them,
    // so adding a field to either shape is a visible edit here.
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
    console.error("first-run status: the newest finding did not satisfy the rendered shape", {
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
  return {
    async read(projectId: string): Promise<StagePersistedFacts> {
      const [state] = await db
        .select({ armedAt: firstRunState.armedAt })
        .from(firstRunState)
        .where(
          and(
            eq(firstRunState.organizationId, ctx.organizationId),
            eq(firstRunState.projectId, projectId),
          ),
        )
        .limit(1);

      const armedAt = state?.armedAt ?? null;
      const finding = await readNewestFinding(db, ctx, projectId);

      // NEVER ARMED IS NOT A MILESTONE-BEARING STATE. Every predicate below is
      // measured FROM the clock origin, and without one there is nothing to
      // measure from — so the two legs are absent as a fact rather than as a
      // comparison against NULL that happens to filter everything out.
      if (armedAt === null) {
        return { ...NO_FACTS, finding };
      }

      // LEG ONE. `finished_at >= armed_at` is what stops this announcing "your
      // failed request reached us" on the surface's FIRST PAINT: the connection
      // has been polling on its own cadence since long before the founder
      // pressed anything, and that older run is not evidence of their trigger.
      const [retrieved] = await db
        .select({ finishedAt: sessionSourcePollRuns.finishedAt })
        .from(sessionSourcePollRuns)
        .where(
          and(
            eq(sessionSourcePollRuns.organizationId, ctx.organizationId),
            eq(sessionSourcePollRuns.projectId, projectId),
            eq(sessionSourcePollRuns.status, "completed"),
            gt(sessionSourcePollRuns.eventsPersisted, 0),
            gte(sessionSourcePollRuns.finishedAt, armedAt),
          ),
        )
        .orderBy(asc(sessionSourcePollRuns.finishedAt))
        .limit(1);

      // LEG TWO, AND THE RUN'S OWN ENDING, from ONE row. `order by started_at
      // asc limit 1` is `min(started_at)` that also hands back the row it came
      // from, so `endedAt` / `runStatus` / `runOutcome` can never describe a
      // different run than `readingAt` does.
      const [run] = await db
        .select({
          startedAt: analysisRuns.startedAt,
          finishedAt: analysisRuns.finishedAt,
          status: analysisRuns.status,
          outcome: analysisRuns.outcome,
        })
        .from(analysisRuns)
        .where(
          and(
            eq(analysisRuns.organizationId, ctx.organizationId),
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
        // Null while, and only while, the run is open — "has not finished", and
        // never "finished with nothing".
        endedAt: run?.finishedAt ?? null,
        runStatus: run?.status ?? null,
        runOutcome: run?.outcome ?? null,
        finding,
      };
    },
  };
}
