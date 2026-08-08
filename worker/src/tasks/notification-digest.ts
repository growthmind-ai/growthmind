import { digestWindowStart } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  emitDigestSummary,
  findLastDigestAt,
  gatherDigestNotifications,
  listOrganizationsDueForDigest,
} from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextFor } from "@growthmind/db/system";
import { NOTIFICATION_LIST_LIMIT } from "@growthmind/shared";

import { isolated, type TaskLogger } from "../task-logger";

export interface NotificationDigestDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

// Gathers and emits; it posts nothing itself. The Slack leg is the ordinary owed arm, so
// the digest adds no Slack call site — a summary posted directly would be the fifth
// bespoke one the seam register exists to forbid. An empty week emits no notification row
// at all, not a row saying nothing happened (ADD D-8).
export async function runNotificationDigest(deps: NotificationDigestDeps): Promise<void> {
  const at = deps.now();

  const due = await listOrganizationsDueForDigest(deps.db, at);

  for (const org of due) {
    // One org's fault must not starve the rest of their summaries (D8).
    await isolated(
      deps.logger,
      `notification digest: organization ${org.organizationId} could not be summarised this run`,
      async () => {
        const ctx = systemContextFor(SYSTEM_ACTOR.NOTIFICATION_DIGEST, org);

        const lastDigestAt = await findLastDigestAt(deps.db, ctx);

        const gathered = await gatherDigestNotifications(deps.db, ctx, {
          windowStart: digestWindowStart(lastDigestAt, at),
          windowEnd: at,
          limit: NOTIFICATION_LIST_LIMIT,
        });

        if (gathered.notificationIds.length === 0) {
          return;
        }

        await emitDigestSummary(deps.db, ctx, {
          notificationIds: gathered.notificationIds,
          totalCount: gathered.totalCount,
          windowEnd: at,
        });
      },
    );
  }

  deps.logger.info(
    `notification digest: ${String(due.length)} organizations were due today in UTC`,
  );
}
