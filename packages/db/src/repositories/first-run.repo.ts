import type { TenantContext } from "@growthmind/shared";
import { eq } from "drizzle-orm";

import { publishLive } from "../live/publish";
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

  // Beside the write, never in the route: the setup screen has no timer behind it any more,
  // so a writer that forgot to announce would leave it frozen mid-setup (D11).
  async function announce(): Promise<void> {
    await publishLive(db, { organizationId: ctx.organizationId, topic: "first_run" });
  }

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

    await announce();

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

      await announce();
    },

    async isDismissed(userId: string): Promise<boolean> {
      const row = await cDismissals.maybe(eq(firstRunDismissals.userId, userId));

      return row !== null;
    },
  };
}
