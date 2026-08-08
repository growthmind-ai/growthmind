import type { ScopedDb } from "@growthmind/db";
import { enqueueJob } from "@growthmind/db";
import { listOrgsWithActiveSlackConnection } from "@growthmind/db/system";
import { NOTIFICATION_RESCUE_TASK } from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

export interface NotificationRescueTickDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

// The producer for the receipts no write will ever follow: a web-only boot records
// `queue_unavailable` precisely when nobody is performing anything, so no reconnect and no
// health recovery can reach it. Fans out one rescue job per org with Slack connected,
// which collapses on the same job key as any rescue a connection write already queued.
export async function runNotificationRescueTick(deps: NotificationRescueTickDeps): Promise<void> {
  const orgs = await listOrgsWithActiveSlackConnection(deps.db);

  for (const org of orgs) {
    await enqueueJob(deps.db, {
      task: NOTIFICATION_RESCUE_TASK,
      payload: { organizationId: org.organizationId },
      jobKey: `${NOTIFICATION_RESCUE_TASK}:${org.organizationId}`,
    });
  }

  deps.logger.info(
    `notification rescue tick: ${String(orgs.length)} organizations with Slack connected were swept`,
  );
}
