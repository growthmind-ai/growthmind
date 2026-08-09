import { FIX_RESULTS_WINDOW_DAYS, type TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { emitChangeReadout } from "../notifications/change-readout";
import { emitChangeReported } from "../notifications/change-reported";
import { inTransaction, orgCrud } from "../repositories/crud";
import { scoped } from "../repositories/scope";
import {
  createShippedChangesRepo,
  type ShippedChangeRow,
} from "../repositories/shipped-changes.repo";
import type { ScopedExecutor } from "../repositories/types";
import { shippedChanges } from "../schema/shipped-changes";

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

export interface ShippedChangesService {
  // No readout date in the input, deliberately: the product sets it from the results window, so
  // the assistant cannot choose the date it is marked on and this stays a forecast.
  reportShipped(input: ReportShippedInput): Promise<ShippedChangeRow>;

  recordReadout(input: RecordReadoutInput): Promise<RecordReadoutResult>;
}

function notOurProject(): Error {
  return new Error("shipped_changes.recordReadout: that project belongs to another organization");
}

export function createShippedChangesService(
  db: ScopedExecutor,
  ctx: TenantContext,
): ShippedChangesService {
  return {
    async reportShipped(input: ReportShippedInput): Promise<ShippedChangeRow> {
      return inTransaction(db, async (tx): Promise<ShippedChangeRow> => {
        const change = await createShippedChangesRepo(tx, ctx).reportShipped({
          projectId: input.projectId,
          page: input.page,
          description: input.description,
          reportedAt: input.reportedAt,
          readoutDueAt: new Date(input.reportedAt.getTime() + RESULTS_WINDOW_MS),
          ...(input.control === undefined ? {} : { control: input.control }),
        });

        // Keyed on the change id, which the upsert holds fixed, so a re-report keys into the
        // acknowledgement that already exists rather than promising a second date.
        await emitChangeReported(tx, change.organizationId, { changeId: change.id });

        return change;
      });
    },

    async recordReadout(input: RecordReadoutInput): Promise<RecordReadoutResult> {
      return inTransaction(db, async (tx): Promise<RecordReadoutResult> => {
        const s = scoped(tx, ctx);
        const changes = orgCrud(tx, ctx, shippedChanges);

        const change = await changes.maybe(eq(shippedChanges.id, input.changeId));

        if (change === null) {
          return { kind: "not_reportable" };
        }

        // The row outlives its project, so the guard resolves the project the row still names.
        if (change.projectId !== null) {
          await s.assertProjectOwned(change.projectId, notOurProject);
        }

        // The transition is the claim: a second readout of the same change finds no row in the
        // reported state and writes neither a readout nor a verdict question.
        const claimed = await changes.update(
          { state: "read_out", readOutAt: input.readOutAt },
          eq(shippedChanges.id, input.changeId),
          eq(shippedChanges.state, "reported"),
        );

        if (claimed === null) {
          return { kind: "already_read_out" };
        }

        await emitChangeReadout(tx, claimed.organizationId, { changeId: claimed.id });

        return { kind: "read_out" };
      });
    },
  };
}
