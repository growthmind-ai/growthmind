import type { DeliveryLaneDecision, DeliveryReasonCode, TenantContext } from "@growthmind/shared";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { deliveryDecisions } from "../schema/delivery-decisions";
import { inTransaction, orgCrud, type ClaimResult } from "./crud";
import type { ScopedExecutor } from "./types";

export type DeliveryDecisionRecord = typeof deliveryDecisions.$inferSelect;

export interface RecordDeliveryDecisionInput {
  readonly projectId: string;

  readonly decision: DeliveryLaneDecision;

  // With `decision`, the whole of what makes a run one run. Two consecutive ticks collapse
  // into one row only when this matches too, so "quiet because the budget is spent" never
  // reads as a continuation of "quiet because nothing was ready".
  readonly reasonCode: DeliveryReasonCode;

  // Plain English, from a constant in @growthmind/shared. Stored, shown, and never compared:
  // a copy pass that rewords it must leave every open run exactly where it was.
  readonly reason: string;

  readonly findingId: string | null;

  readonly channelId: string | null;

  readonly decidedAt: Date;
}

export interface RecordedDeliveryDecision {
  readonly run: DeliveryDecisionRecord;

  // False when a racing tick had already opened a run carrying a different answer. This
  // tick's decision was not written, and `run` is the one that won.
  readonly recorded: boolean;
}

export interface DeliveryDecisionsRepo {
  record(input: RecordDeliveryDecisionInput): Promise<RecordedDeliveryDecision>;

  // Newest run first. A run is one uninterrupted stretch of the same answer, so the number a
  // caller asks for is a number of answers, not of ticks.
  listRecentForProject(projectId: string, limit: number): Promise<DeliveryDecisionRecord[]>;

  currentForProject(projectId: string): Promise<DeliveryDecisionRecord | null>;
}

const OPEN_RUN_TARGET = [deliveryDecisions.organizationId, deliveryDecisions.projectId];

const OPEN_RUN = sql`${deliveryDecisions.endedAt} is null`;

function openRunFor(projectId: string) {
  return and(eq(deliveryDecisions.projectId, projectId), isNull(deliveryDecisions.endedAt));
}

// Composed through `sql` rather than `or`/`and`, which widen to `SQL | undefined` and would
// silently drop the predicate — closing a run that had not changed, or letting the upsert
// overwrite a run this tick did not label.
function answerChanged(input: RecordDeliveryDecisionInput) {
  return sql`(${ne(deliveryDecisions.decision, input.decision)} or ${ne(
    deliveryDecisions.reasonCode,
    input.reasonCode,
  )})`;
}

function sameAnswer(input: RecordDeliveryDecisionInput) {
  return sql`(${eq(deliveryDecisions.decision, input.decision)} and ${eq(
    deliveryDecisions.reasonCode,
    input.reasonCode,
  )})`;
}

// A tick that commits after a later one must not rewind what the row already knows: the
// staleness alarm on /channel reads `last_decided_at` as the lane's heartbeat, and the
// finding and channel belong to whichever tick spoke last.
function extension(input: RecordDeliveryDecisionInput) {
  const superseded = sql`${deliveryDecisions.lastDecidedAt} > ${input.decidedAt}::timestamptz`;

  return {
    lastDecidedAt: sql`greatest(${deliveryDecisions.lastDecidedAt}, ${input.decidedAt}::timestamptz)`,
    findingId: sql`case when ${superseded} then ${deliveryDecisions.findingId} else ${input.findingId}::text end`,
    channelId: sql`case when ${superseded} then ${deliveryDecisions.channelId} else ${input.channelId}::text end`,
  };
}

// The second of the two statements a tick runs, apart from the first because the interleave
// that matters is the one where it arrives alone: a losing tick's close-update evaluates
// before the winner commits, closes nothing, and reaches this insert against a row carrying
// somebody else's answer. `setWhere` is what makes that a no-op rather than a silent write of
// this tick's finding onto the winner's decision (D6).
export function extendOrOpenRun(
  db: ScopedExecutor,
  ctx: TenantContext,
  input: RecordDeliveryDecisionInput,
): Promise<ClaimResult<DeliveryDecisionRecord>> {
  return orgCrud(db, ctx, deliveryDecisions).claim(
    {
      projectId: input.projectId,
      decision: input.decision,
      reasonCode: input.reasonCode,
      reason: input.reason,
      findingId: input.findingId,
      channelId: input.channelId,
      firstDecidedAt: input.decidedAt,
      lastDecidedAt: input.decidedAt,
    },
    {
      target: OPEN_RUN_TARGET,
      targetWhere: OPEN_RUN,
      setWhere: sameAnswer(input),
      set: extension(input),
      fetch: [openRunFor(input.projectId)],
    },
  );
}

export function createDeliveryDecisionsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): DeliveryDecisionsRepo {
  const reads = orgCrud(db, ctx, deliveryDecisions);

  return {
    async record(input: RecordDeliveryDecisionInput): Promise<RecordedDeliveryDecision> {
      return inTransaction(db, async (tx) => {
        // Close first, because the partial unique index would otherwise refuse the insert.
        await orgCrud(tx, ctx, deliveryDecisions).update(
          { endedAt: input.decidedAt },
          openRunFor(input.projectId),
          answerChanged(input),
        );

        // A retried tick reaches the surviving open run through the conflict target and only
        // moves `last_decided_at`, so the retry writes no second row (D4).
        const claimed = await extendOrOpenRun(tx, ctx, input);

        if (claimed.row === null) {
          throw new Error(
            `delivery_decisions.record: the ${input.decision} run for project ${input.projectId} was neither opened nor extended`,
          );
        }

        // Losing the race drops this tick's decision rather than closing a run a racing tick
        // opened milliseconds ago: two ticks disagreeing about one lane at one instant is
        // itself the race, and the next tick settles it against a run whose start is intact.
        return { run: claimed.row, recorded: claimed.claimed };
      });
    },

    async listRecentForProject(
      projectId: string,
      limit: number,
    ): Promise<DeliveryDecisionRecord[]> {
      return reads.list({
        where: eq(deliveryDecisions.projectId, projectId),
        orderBy: [desc(deliveryDecisions.firstDecidedAt)],
        limit,
      });
    },

    async currentForProject(projectId: string): Promise<DeliveryDecisionRecord | null> {
      return reads.maybe(openRunFor(projectId));
    },
  };
}
