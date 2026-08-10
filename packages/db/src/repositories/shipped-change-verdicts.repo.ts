import type { ShippedVerdict, TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { inTransaction, orgCrud } from "./crud";
import { scoped } from "./scope";
import { shippedChangeVerdicts } from "../schema/shipped-change-verdicts";
import { shippedChanges } from "../schema/shipped-changes";
import type { ScopedExecutor } from "./types";

export type ShippedChangeVerdictRow = typeof shippedChangeVerdicts.$inferSelect;

export interface RecordVerdictInput {
  readonly changeId: string;
  readonly verdict: ShippedVerdict;
  readonly recordedAt: Date;
  readonly recordedBySlackUserId?: string | null;
}

// `abandoned` is its own answer rather than folded into `not_read_out`: a change closed with a
// reason may well have been read out, so telling the founder we have not read it out yet would
// be false. Nothing posts buttons on a row that reaches this state, so it is unreachable from
// Slack today and the caller still has a true sentence for it.
export type RecordVerdictResult = {
  readonly kind: "recorded" | "already_recorded" | "not_read_out" | "abandoned";
};

export interface ShippedChangeVerdictsRepo {
  // The atomic close and the answer in one transaction, so it serves the button press and
  // the lapse with the same guarantee: one verdict per change, first answer wins.
  recordVerdict(input: RecordVerdictInput): Promise<RecordVerdictResult>;

  findForChange(changeId: string): Promise<ShippedChangeVerdictRow | null>;
}

function notOurProject(): Error {
  return new Error(
    "shipped_change_verdicts: that change's project belongs to another organization",
  );
}

export function createShippedChangeVerdictsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): ShippedChangeVerdictsRepo {
  return {
    async recordVerdict(input: RecordVerdictInput): Promise<RecordVerdictResult> {
      return inTransaction(db, async (tx): Promise<RecordVerdictResult> => {
        const s = scoped(tx, ctx);
        const changes = orgCrud(tx, ctx, shippedChanges);
        const verdicts = orgCrud(tx, ctx, shippedChangeVerdicts);

        const change = await changes.maybe(eq(shippedChanges.id, input.changeId));

        if (change === null) {
          return { kind: "not_read_out" };
        }

        if (change.state === "abandoned") {
          return { kind: "abandoned" };
        }

        // This repository takes no project id, so the ownership guard resolves the change
        // row's own project. A change whose project is gone keeps its verdict path open.
        if (change.projectId !== null) {
          await s.assertProjectOwned(change.projectId, notOurProject);
        }

        const closed = await changes.update(
          { state: "closed", closedAt: input.recordedAt },
          eq(shippedChanges.id, input.changeId),
          eq(shippedChanges.state, "read_out"),
        );

        if (closed === null) {
          const current = await changes.maybe(eq(shippedChanges.id, input.changeId));

          if (current?.state === "closed") return { kind: "already_recorded" };
          if (current?.state === "abandoned") return { kind: "abandoned" };

          return { kind: "not_read_out" };
        }

        const claim = await verdicts.claim(
          {
            changeId: input.changeId,
            verdict: input.verdict,

            // Read off the row the close just claimed, so the branch stored is the one the
            // founder was actually shown rather than one recomputed later.
            readoutOutcome: closed.readoutOutcome,
            recordedAt: input.recordedAt,
            recordedBySlackUserId: input.recordedBySlackUserId ?? null,
          },
          {
            target: [shippedChangeVerdicts.organizationId, shippedChangeVerdicts.changeId],
            fetch: [eq(shippedChangeVerdicts.changeId, input.changeId)],
          },
        );

        return { kind: claim.claimed ? "recorded" : "already_recorded" };
      });
    },

    async findForChange(changeId: string): Promise<ShippedChangeVerdictRow | null> {
      return orgCrud(db, ctx, shippedChangeVerdicts).maybe(
        eq(shippedChangeVerdicts.changeId, changeId),
      );
    },
  };
}
