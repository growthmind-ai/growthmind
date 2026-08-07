import type { DismissalAction, TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";

import { publishLive } from "../live/publish";
import { dismissals } from "../schema/dismissals";
import { orgCrud } from "./crud";
import type { SignatureHex } from "../signatures/hex";
import type { ScopedExecutor } from "./types";

export type DismissalRecord = typeof dismissals.$inferSelect;

export interface RecordDismissalRowInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly signature: SignatureHex;
  readonly action: DismissalAction;

  readonly dismissedByUserId: string | null;
  readonly dismissedAt: Date;
}

export interface DismissalsRepo {
  record(input: RecordDismissalRowInput): Promise<DismissalRecord>;

  findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null>;

  findLatestForSignature(
    projectId: string,
    signature: SignatureHex,
  ): Promise<DismissalRecord | null>;
}

export function createDismissalsRepo(db: ScopedExecutor, ctx: TenantContext): DismissalsRepo {
  const c = orgCrud(db, ctx, dismissals);

  return {
    async record(input: RecordDismissalRowInput): Promise<DismissalRecord> {
      // `claim`, not `insertOrFetch`: a Slack retry or a double-press re-presents the same
      // dismissal, and the row it fetches is the one already there (D3, D4).
      const claimed = await c.claim(
        {
          projectId: input.projectId,
          findingId: input.findingId,
          signature: input.signature,
          action: input.action,
          dismissedByUserId: input.dismissedByUserId,
          dismissedAt: input.dismissedAt,
        },
        {
          target: [dismissals.organizationId, dismissals.findingId, dismissals.action],
          fetch: [eq(dismissals.findingId, input.findingId), eq(dismissals.action, input.action)],
        },
      );

      if (claimed.row === null) {
        throw new Error("dismissals: the row this call conflicted with could not be read back");
      }

      const row = claimed.row;

      // A dismissal folds the finding out of both surfaces, and it can arrive from Slack —
      // a press nobody's browser made (D1).
      if (claimed.claimed) {
        await publishLive(db, { organizationId: ctx.organizationId, topic: "findings" });
        await publishLive(db, { organizationId: ctx.organizationId, topic: "first_run" });
      }

      return row;
    },

    async findFor(findingId: string, action: DismissalAction): Promise<DismissalRecord | null> {
      return c.maybe(eq(dismissals.findingId, findingId), eq(dismissals.action, action));
    },

    async findLatestForSignature(
      projectId: string,
      signature: SignatureHex,
    ): Promise<DismissalRecord | null> {
      const rows = await c.list({
        where: and(eq(dismissals.projectId, projectId), eq(dismissals.signature, signature)),
        orderBy: [desc(dismissals.dismissedAt)],
        limit: 1,
      });

      return rows[0] ?? null;
    },
  };
}
