import type { TenantContext } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { firstRunDismissals } from "../schema/first-run-dismissals";
import { firstRunState } from "../schema/first-run-state";
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
  return {
    async readState(projectId: string): Promise<FirstRunState | null> {
      const [row] = await db
        .select({
          armedAt: firstRunState.armedAt,
          slackSkippedAt: firstRunState.slackSkippedAt,
        })
        .from(firstRunState)
        .where(
          and(
            eq(firstRunState.organizationId, ctx.organizationId),
            eq(firstRunState.projectId, projectId),
          ),
        )
        .limit(1);

      return row ? toFirstRunState(row) : null;
    },

    async arm(projectId: string, armedAt: Date): Promise<FirstRunState> {
      const [row] = await db
        .insert(firstRunState)
        .values({ organizationId: ctx.organizationId, projectId, armedAt })
        .onConflictDoUpdate({
          target: [firstRunState.organizationId, firstRunState.projectId],
          set: { armedAt },
        })
        .returning();

      if (!row) {
        throw new Error("arm: upsert returned no first_run_state row");
      }

      return toFirstRunState(row);
    },

    async skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState> {
      const [row] = await db
        .insert(firstRunState)
        .values({ organizationId: ctx.organizationId, projectId, slackSkippedAt: skippedAt })
        .onConflictDoUpdate({
          target: [firstRunState.organizationId, firstRunState.projectId],
          set: { slackSkippedAt: skippedAt },
        })
        .returning();

      if (!row) {
        throw new Error("skipSlack: upsert returned no first_run_state row");
      }

      return toFirstRunState(row);
    },

    async dismiss(userId: string, dismissedAt: Date): Promise<void> {
      await db
        .insert(firstRunDismissals)
        .values({ organizationId: ctx.organizationId, userId, dismissedAt })
        .onConflictDoUpdate({
          target: [firstRunDismissals.organizationId, firstRunDismissals.userId],
          set: { dismissedAt },
        });
    },

    async isDismissed(userId: string): Promise<boolean> {
      const [row] = await db
        .select({ userId: firstRunDismissals.userId })
        .from(firstRunDismissals)
        .where(
          and(
            eq(firstRunDismissals.organizationId, ctx.organizationId),
            eq(firstRunDismissals.userId, userId),
          ),
        )
        .limit(1);

      return row !== undefined;
    },
  };
}
