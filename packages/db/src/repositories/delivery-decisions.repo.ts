import type { DeliveryLaneDecision, TenantContext } from "@growthmind/shared";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { deliveryDecisions } from "../schema/delivery-decisions";
import { inTransaction, orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

export type DeliveryDecisionRecord = typeof deliveryDecisions.$inferSelect;

export interface RecordDeliveryDecisionInput {
  readonly projectId: string;

  readonly decision: DeliveryLaneDecision;

  // Plain English, from a constant in @growthmind/shared. Two consecutive ticks collapse
  // into one run only when this matches as well as the decision, so "quiet because the
  // budget is spent" never reads as a continuation of "quiet because nothing was ready".
  readonly reason: string;

  readonly findingId: string | null;

  readonly channelId: string | null;

  readonly decidedAt: Date;
}

export interface DeliveryDecisionsRepo {
  record(input: RecordDeliveryDecisionInput): Promise<DeliveryDecisionRecord>;

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

export function createDeliveryDecisionsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): DeliveryDecisionsRepo {
  const reads = orgCrud(db, ctx, deliveryDecisions);

  return {
    async record(input: RecordDeliveryDecisionInput): Promise<DeliveryDecisionRecord> {
      return inTransaction(db, async (tx) => {
        const writes = orgCrud(tx, ctx, deliveryDecisions);

        // Close first, because the partial unique index would otherwise refuse the insert.
        // Composed through `sql` rather than `or`, which widens to `SQL | undefined` and
        // would silently drop the predicate, closing a run that had not changed.
        await writes.update(
          { endedAt: input.decidedAt },
          openRunFor(input.projectId),
          sql`(${ne(deliveryDecisions.decision, input.decision)} or ${ne(
            deliveryDecisions.reason,
            input.reason,
          )})`,
        );

        // A retried tick reaches the surviving open run through the conflict target and only
        // moves `last_decided_at`, so the retry writes no second row (D4).
        const claimed = await writes.claim(
          {
            projectId: input.projectId,
            decision: input.decision,
            reason: input.reason,
            findingId: input.findingId,
            channelId: input.channelId,
            firstDecidedAt: input.decidedAt,
            lastDecidedAt: input.decidedAt,
          },
          {
            target: OPEN_RUN_TARGET,
            targetWhere: OPEN_RUN,
            set: {
              lastDecidedAt: input.decidedAt,
              findingId: input.findingId,
              channelId: input.channelId,
            },
            fetch: [openRunFor(input.projectId)],
          },
        );

        if (claimed.row === null) {
          throw new Error(
            `delivery_decisions.record: the ${input.decision} run for project ${input.projectId} was neither opened nor extended`,
          );
        }

        return claimed.row;
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
