import {
  FIX_RESULTS_WINDOW_DAYS,
  logger,
  type ShippedAbandonedReason,
  type TenantContext,
} from "@growthmind/shared";
import { eq, inArray } from "drizzle-orm";

import { emitChangeReadout } from "../notifications/change-readout";
import { emitChangeReported } from "../notifications/change-reported";
import { inTransaction, orgCrud } from "../repositories/crud";
import { scoped } from "../repositories/scope";
import {
  createShippedChangesRepo,
  type ReportShippedChangeResult,
} from "../repositories/shipped-changes.repo";
import type { ScopedDb } from "../repositories/types";
import { shippedChanges } from "../schema/shipped-changes";
import { shippedReadoutOutcomeFor } from "./shipped-readout.service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RESULTS_WINDOW_MS = FIX_RESULTS_WINDOW_DAYS * MS_PER_DAY;

export interface ReportShippedInput {
  readonly projectId: string;
  readonly page: string;
  readonly description: string;
  readonly reportedAt: Date;
  readonly control?: string;
}

export interface RecordReadoutInput {
  readonly changeId: string;
  readonly readOutAt: Date;
}

export type RecordReadoutResult = {
  readonly kind: "read_out" | "already_read_out" | "not_reportable";
};

export interface AbandonChangeInput {
  readonly changeId: string;
  readonly reason: ShippedAbandonedReason;
  readonly at: Date;
}

export type AbandonChangeResult = {
  readonly kind: "abandoned" | "not_reportable";
};

export interface ShippedChangesService {
  // No readout date in the input, deliberately: the product sets it from the results window, so
  // the assistant cannot choose the date it is marked on and this stays a forecast.
  reportShipped(input: ReportShippedInput): Promise<ReportShippedChangeResult>;

  recordReadout(input: RecordReadoutInput): Promise<RecordReadoutResult>;

  abandon(input: AbandonChangeInput): Promise<AbandonChangeResult>;
}

function notOurProject(): Error {
  return new Error("shipped_changes.recordReadout: that project belongs to another organization");
}

export function createShippedChangesService(
  db: ScopedDb,
  ctx: TenantContext,
): ShippedChangesService {
  return {
    async reportShipped(input: ReportShippedInput): Promise<ReportShippedChangeResult> {
      return inTransaction(db, async (tx): Promise<ReportShippedChangeResult> => {
        const result = await createShippedChangesRepo(tx, ctx).reportShipped({
          projectId: input.projectId,
          page: input.page,
          description: input.description,
          reportedAt: input.reportedAt,
          readoutDueAt: new Date(input.reportedAt.getTime() + RESULTS_WINDOW_MS),
          ...(input.control === undefined ? {} : { control: input.control }),
        });

        // A date is promised where a clock started: on the report that created the row, and on
        // the one that put a change we could not measure back on the clock. A re-report inside
        // the window keys into the acknowledgement that already exists.
        if (result.claim !== "reported" && result.claim !== "watching_again") {
          return result;
        }

        const change = result.change;
        const { emitted } = await emitChangeReported(tx, change.organizationId, {
          changeId: change.id,
        });

        // The row is the fact and survives its announcement (D8), but a promise nobody heard is
        // worth knowing about.
        if (!emitted) {
          logger.warn("shipped changes: a change was recorded and its acknowledgement was not", {
            changeId: change.id,
          });
        }

        return result;
      });
    },

    async recordReadout(input: RecordReadoutInput): Promise<RecordReadoutResult> {
      const change = await orgCrud(db, ctx, shippedChanges).maybe(
        eq(shippedChanges.id, input.changeId),
      );

      if (change === null) {
        return { kind: "not_reportable" };
      }

      // The row outlives its project, so the guard resolves the project the row still names.
      if (change.projectId !== null) {
        await scoped(db, ctx).assertProjectOwned(change.projectId, notOurProject);
      }

      // Read before the claim, because a re-report may only reopen a change we could not
      // measure, and nothing downstream can recover which branch the founder was shown. A row
      // the claim below cannot take is not worth reading a corpus for.
      const readoutOutcome =
        change.state === "reported" ? await shippedReadoutOutcomeFor(db, ctx, change) : null;

      return inTransaction(db, async (tx): Promise<RecordReadoutResult> => {
        const changes = orgCrud(tx, ctx, shippedChanges);

        // The transition is the claim: a second readout of the same change finds no row in the
        // reported state and writes neither a readout nor a verdict question.
        const claimed = await changes.update(
          { state: "read_out", readOutAt: input.readOutAt, readoutOutcome },
          eq(shippedChanges.id, input.changeId),
          eq(shippedChanges.state, "reported"),
        );

        if (claimed === null) {
          return { kind: "already_read_out" };
        }

        const { emitted } = await emitChangeReadout(tx, claimed.organizationId, {
          changeId: claimed.id,
        });

        // The notification is the readout rather than a side effect of it, so a swallowed emit
        // takes the transition with it. Committing read_out with nothing announced drops the row
        // out of the due scan and lets the lapse pass record a silence nobody was asked to break.
        if (!emitted) {
          throw new Error(
            `shipped_changes.recordReadout: ${claimed.id} could not be announced, so it is not being recorded as read out`,
          );
        }

        return { kind: "read_out" };
      });
    },

    async abandon(input: AbandonChangeInput): Promise<AbandonChangeResult> {
      // One conditional statement, and no notification: there is nothing honest to say about a
      // change whose project is gone or whose readout never reached anyone, and the state is
      // what stops the row being read out or answered later. Both open states are claimable —
      // project_gone closes a reported row, never_asked closes one already read out.
      const claimed = await orgCrud(db, ctx, shippedChanges).update(
        { state: "abandoned", abandonedReason: input.reason, closedAt: input.at },
        eq(shippedChanges.id, input.changeId),
        inArray(shippedChanges.state, ["reported", "read_out"]),
      );

      return { kind: claimed === null ? "not_reportable" : "abandoned" };
    },
  };
}
