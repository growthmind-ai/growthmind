import type { OnboardingFinding, StagePersistedFacts, TenantContext } from "@growthmind/shared";
import { logger, onboardingFindingSchema } from "@growthmind/shared";
import { asc, eq, gt, gte } from "drizzle-orm";

import { describeDriverError } from "../repositories/driver-error";
import { describeHold } from "../repositories/finding-text";
import { createFindingsRepo } from "../repositories/findings.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { analysisRuns } from "../schema/analysis-runs";
import { firstRunState } from "../schema/first-run-state";
import { sessionSourcePollRuns } from "../schema/session-source-poll-runs";
import { createSignatureLedgerService } from "./signature-ledger.service";
import type { SignatureHex } from "../signatures/hex";

// Three facts about ONE row, from ONE read: the card, the delivery line and the fault
// sentence each ran a bounded finding read of their own, and a row landing between two
// of them gave one finding card the next finding delivery state (B-038).
export interface FirstRunStatusFacts extends StagePersistedFacts {
  readonly findingId: string | null;

  // A row is there and will not render — not simply `finding === null`.
  readonly findingUnavailable: boolean;

  // The text was refused at the read seam, and the delivery lane refuses it on the same
  // terms — so no channel holds a copy, and no screen may send a reader to one.
  readonly findingWithheld: boolean;
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
  readonly withheld: boolean;
}

// Absent, and could-not-read-it-just-now. `findingUnavailable` stops the poll, so a pool
// timeout that reported one ended the watch for good (B-042).
const NO_FINDING: NewestFinding = { id: null, finding: null, unavailable: false, withheld: false };

// A row IS there and will not render; re-reading changes nothing.
const UNRENDERABLE: NewestFinding = {
  id: null,
  finding: null,
  unavailable: true,
  withheld: false,
};

// Unrenderable here AND undelivered anywhere, which the shape refusal above is not.
const WITHHELD: NewestFinding = { id: null, finding: null, unavailable: true, withheld: true };

// A malformed row arrives as a `ZodError` from the repository DTO boundary; a pool
// timeout arrives as a driver error. Same catch, opposite meanings.
function isShapeFailure(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ZodError"
  );
}

interface ShapeIssue {
  readonly path: string;
  readonly code: string;
}

function shapeIssuesOf(error: unknown): readonly ShapeIssue[] {
  const raw = (error as { readonly issues?: unknown }).issues;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((issue: unknown) => {
    const { path, code } = issue as { readonly path?: unknown; readonly code?: unknown };
    return {
      path: Array.isArray(path) ? path.map((segment: unknown) => String(segment)).join(".") : "",
      code: typeof code === "string" ? code : "unrecognised",
    };
  });
}

// Path and code only. `describeDriverError` falls through to `error.message`, and a
// `ZodError`'s message is its whole serialised issue array — `unrecognized_keys` carries
// the offending keys in it verbatim, and a refinement's message can carry anything.
function describeReadFailure(error: unknown): {
  readonly reason: string;
  readonly issues?: readonly ShapeIssue[];
} {
  return isShapeFailure(error)
    ? { reason: "shape", issues: shapeIssuesOf(error) }
    : { reason: describeDriverError(error) };
}

async function readNewestFinding(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
  armedAt: Date | null,
): Promise<NewestFinding> {
  let record;
  try {
    [record] = await createFindingsRepo(db, ctx).listForProject(projectId, { limit: 1 });
  } catch (error) {
    // Never the caught value: a failed query message IS the statement and its bound
    // parameters, and a DTO refusal arrives here as a `ZodError` rather than a driver one.
    logger.error("first-run status: could not read the newest finding for the project", {
      organizationId: ctx.organizationId,
      projectId,
      ...describeReadFailure(error),
    });

    // A driver failure is not a fault the screen may claim, and going terminal on one
    // ends the watch for good.
    return isShapeFailure(error) ? UNRENDERABLE : NO_FINDING;
  }

  if (!record) {
    return NO_FINDING;
  }

  // Only a row from THIS watch is a fault this watch may report: a project already holding
  // a row nothing can render made a fresh "Start watching" terminal on arrival (B-042).
  const fromThisWatch = armedAt !== null && record.createdAt > armedAt;

  const text = record.text;
  if (text.held) {
    // Both branches log, so a hold is never silent to an operator. The screen is told only
    // that nothing renders: naming which hold describes what was withheld. `warn`, not
    // `error`: every row written before the scan existed reaches this line on every poll.
    logger.warn("first-run status: the newest finding's text is held, so no card is shown", {
      organizationId: ctx.organizationId,
      projectId,
      findingId: record.id,
      ...describeHold(text),
    });

    return fromThisWatch ? WITHHELD : NO_FINDING;
  }

  const parsed = onboardingFindingSchema.safeParse({
    finalClass: record.finalClass,
    headline: text.headline,
    context: text.context,

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
      ...describeReadFailure(parsed.error),
    });

    // No id, so `finding === null` implies `findingId === null` (B-038).
    return fromThisWatch ? UNRENDERABLE : NO_FINDING;
  }

  // A dismissal is working as designed, never a fault (ADD o-019-dismissal-wired Decision
  // 2) — the card falls back to whatever earlier stage state applies, exactly like a row
  // that has not arrived yet. A thrown consult reuses the same fromThisWatch split as every
  // other read in this function (Decision 3): a genuine failure on this watch's own row is
  // an honest fault, a failure resolving an older row is silence, matching precedent exactly.
  try {
    const decision = await createSignatureLedgerService(db, ctx).consultSignature(
      projectId,
      record.signature as SignatureHex,
    );

    if (decision.decision === "suppress") {
      return NO_FINDING;
    }
  } catch (error) {
    logger.error("first-run status: could not confirm the newest finding was not dismissed", {
      organizationId: ctx.organizationId,
      projectId,
      findingId: record.id,
      ...describeReadFailure(error),
    });

    return fromThisWatch ? UNRENDERABLE : NO_FINDING;
  }

  return { id: record.id, finding: parsed.data, unavailable: false, withheld: false };
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
      const newest = await readNewestFinding(db, ctx, projectId, armedAt);
      const found = {
        finding: newest.finding,
        findingId: newest.id,
        findingUnavailable: newest.unavailable,
        findingWithheld: newest.withheld,
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
