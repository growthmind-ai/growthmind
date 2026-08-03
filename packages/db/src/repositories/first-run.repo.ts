import type { TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { firstRunDismissals } from "../schema/first-run-dismissals";
import { firstRunState } from "../schema/first-run-state";
import { scoped } from "./scope";
import type { ScopedDb } from "./types";

export interface FirstRunState {
  readonly armedAt: Date | null;

  readonly slackSkippedAt: Date | null;
}

export interface FirstRunRepo {
  readState(projectId: string): Promise<FirstRunState | null>;

  arm(projectId: string, armedAt: Date): Promise<FirstRunState>;

  skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState>;

  dismiss(userId: string, dismissedAt: Date): Promise<void>;
  isDismissed(userId: string): Promise<boolean>;
}

function toFirstRunState(row: {
  armedAt: Date | null;
  slackSkippedAt: Date | null;
}): FirstRunState {
  return { armedAt: row.armedAt, slackSkippedAt: row.slackSkippedAt };
}

export function createFirstRunRepo(db: ScopedDb, ctx: TenantContext): FirstRunRepo {
  const s = scoped(db, ctx);

  async function upsertState(
    projectId: string,
    set: { armedAt: Date } | { slackSkippedAt: Date },
    label: string,
  ): Promise<FirstRunState> {
    const rows = await db
      .insert(firstRunState)
      .values({ ...s.stamp, projectId, ...set })
      .onConflictDoUpdate({
        target: [firstRunState.organizationId, firstRunState.projectId],
        set,
      })
      .returning();

    return toFirstRunState(s.one(rows, label));
  }

  return {
    async readState(projectId: string): Promise<FirstRunState | null> {
      const row = s.maybe(
        await db
          .select({
            armedAt: firstRunState.armedAt,
            slackSkippedAt: firstRunState.slackSkippedAt,
          })
          .from(firstRunState)
          .where(s.owned(firstRunState, eq(firstRunState.projectId, projectId)))
          .limit(1),
      );

      return row ? toFirstRunState(row) : null;
    },

    async arm(projectId: string, armedAt: Date): Promise<FirstRunState> {
      return upsertState(projectId, { armedAt }, "createFirstRunRepo.arm");
    },

    async skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState> {
      return upsertState(projectId, { slackSkippedAt: skippedAt }, "createFirstRunRepo.skipSlack");
    },

    async dismiss(userId: string, dismissedAt: Date): Promise<void> {
      await db
        .insert(firstRunDismissals)
        .values({ ...s.stamp, userId, dismissedAt })
        .onConflictDoUpdate({
          target: [firstRunDismissals.organizationId, firstRunDismissals.userId],
          set: { dismissedAt },
        });
    },

    async isDismissed(userId: string): Promise<boolean> {
      const row = s.maybe(
        await db
          .select({ userId: firstRunDismissals.userId })
          .from(firstRunDismissals)
          .where(s.owned(firstRunDismissals, eq(firstRunDismissals.userId, userId)))
          .limit(1),
      );

      return row !== null;
    },
  };
}
