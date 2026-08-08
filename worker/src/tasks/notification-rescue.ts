import { dispatchClaimsExpireBefore, NOTIFICATION_DISPATCH_MAX_ATTEMPTS } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import { enqueueJob, listUnsettledNotificationIds } from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextForOrganizationId } from "@growthmind/db/system";
import {
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_WINDOW_DAYS,
  notificationRescuePayloadSchema,
} from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

export interface NotificationRescueDeps {
  readonly db: ScopedDb;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

// One dispatch job per unsettled notification inside the window. Idempotent by
// construction: every job it queues is a dispatch job whose settled check and claim lease
// already make a duplicate free, and the emit-time job key collapses a rescue's job with
// the original rather than double-queuing (ADD D-4).
export async function runNotificationRescue(
  payload: unknown,
  deps: NotificationRescueDeps,
): Promise<void> {
  const { organizationId } = notificationRescuePayloadSchema.parse(payload);

  const ctx = await systemContextForOrganizationId(
    deps.db,
    SYSTEM_ACTOR.NOTIFICATION_RESCUE,
    organizationId,
  );

  if (ctx === null) {
    deps.logger.info(
      `notification rescue: organization ${organizationId} is no longer there, so this sweep is done`,
    );
    return;
  }

  const now = deps.now();

  const unsettled = await listUnsettledNotificationIds(deps.db, ctx, {
    since: new Date(now.getTime() - NOTIFICATION_WINDOW_DAYS * DAY_MS),
    staleClaimsBefore: dispatchClaimsExpireBefore(now),
  });

  for (const notificationId of unsettled) {
    await enqueueJob(deps.db, {
      task: NOTIFICATION_DISPATCH_TASK,
      payload: { organizationId, notificationId },
      jobKey: `${NOTIFICATION_DISPATCH_TASK}:${notificationId}`,
      maxAttempts: NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
    });
  }

  deps.logger.info(
    `notification rescue: ${String(unsettled.length)} of this organization's notifications were queued for delivery`,
  );
}
