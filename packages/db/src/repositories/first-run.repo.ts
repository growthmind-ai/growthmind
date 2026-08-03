import type { TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { firstRunDismissals } from "../schema/first-run-dismissals";
import { firstRunState } from "../schema/first-run-state";
import { orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

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

export function createFirstRunRepo(db: ScopedExecutor, ctx: TenantContext): FirstRunRepo {
  const cState = orgCrud(db, ctx, firstRunState);
  const cDismissals = orgCrud(db, ctx, firstRunDismissals);

  async function upsertState(
    projectId: string,
    set: { armedAt: Date } | { slackSkippedAt: Date },
  ): Promise<FirstRunState> {
    const row = await cState.insertOrFetch(
      { projectId, ...set },
      {
        target: [firstRunState.organizationId, firstRunState.projectId],
        set,
        fetch: [eq(firstRunState.projectId, projectId)],
      },
    );

    return toFirstRunState(row);
  }

  return {
    async readState(projectId: string): Promise<FirstRunState | null> {
      const row = await cState.maybe(eq(firstRunState.projectId, projectId));

      return row ? toFirstRunState(row) : null;
    },

    async arm(projectId: string, armedAt: Date): Promise<FirstRunState> {
      return upsertState(projectId, { armedAt });
    },

    async skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState> {
      return upsertState(projectId, { slackSkippedAt: skippedAt });
    },

    async dismiss(userId: string, dismissedAt: Date): Promise<void> {
      await cDismissals.insertOrFetch(
        { userId, dismissedAt },
        {
          target: [firstRunDismissals.organizationId, firstRunDismissals.userId],
          set: { dismissedAt },
          fetch: [eq(firstRunDismissals.userId, userId)],
        },
      );
    },

    async isDismissed(userId: string): Promise<boolean> {
      const row = await cDismissals.maybe(eq(firstRunDismissals.userId, userId));

      return row !== null;
    },
  };
}
