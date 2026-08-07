import {
  NOTIFICATION_SEND_NO_TARGET,
  type NotificationSendFailureReason,
  type NotificationType,
} from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { organization } from "../schema/auth";
import { notifications, notificationSends } from "../schema/notifications";
import { slackConnections } from "../schema/slack-connections";
import { toSlackConnectionSummary } from "../repositories/slack-connections.repo";
import type { ScopedExecutor } from "../repositories/types";
import { isDeliveryTarget } from "./delivery-channel-guard";

export interface NotificationForDispatch {
  readonly id: string;
  readonly type: NotificationType;
  readonly subjectId: string;
  readonly actorUserId: string | null;
  readonly organizationName: string;

  // A receipt already recorded for this channel: the post happened, or was decided against,
  // on an earlier run of this job (D4).
  readonly settled: boolean;

  // Resolved at post time rather than at emit: an org that disconnected in between gets the
  // honest quiet receipt, and the chip explains it.
  readonly channelId: string | null;
}

// The worker's read model for one queued notification. Org-scoped by the payload's own
// organization id, which the emit wrote — a job for a row in another tenant matches nothing.
export async function readNotificationForDispatch(
  db: ScopedExecutor,
  input: { readonly organizationId: string; readonly notificationId: string },
): Promise<NotificationForDispatch | null> {
  const [row] = await db
    .select({ notification: notifications, organizationName: organization.name })
    .from(notifications)
    .innerJoin(organization, eq(organization.id, notifications.organizationId))
    .where(
      and(
        eq(notifications.id, input.notificationId),
        eq(notifications.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const settled = await db
    .select({ status: notificationSends.status })
    .from(notificationSends)
    .where(
      and(
        eq(notificationSends.notificationId, input.notificationId),
        eq(notificationSends.channel, "slack"),
      ),
    );

  const [connection] = await db
    .select()
    .from(slackConnections)
    .where(
      and(
        eq(slackConnections.organizationId, input.organizationId),
        eq(slackConnections.isActive, true),
      ),
    )
    .limit(1);

  const summary = connection ? toSlackConnectionSummary(connection) : null;

  return {
    id: row.notification.id,
    type: row.notification.type as NotificationType,
    subjectId: row.notification.subjectId,
    actorUserId: row.notification.actorUserId,
    organizationName: row.organizationName,
    settled: settled.some((send) => send.status === "sent" || send.status === "quiet"),
    channelId: summary !== null && isDeliveryTarget(summary) ? summary.channelId : null,
  };
}

export type DispatchOutcome =
  | { readonly status: "sent"; readonly target: string; readonly messageRef: string | null }
  | {
      readonly status: "failed";
      readonly target: string;
      readonly failureReason: NotificationSendFailureReason;
    }
  | { readonly status: "quiet" };

// Conflict-tolerant on the same unique key the emit uses: a retry that raced an earlier run
// records nothing twice.
export async function recordDispatchOutcome(
  db: ScopedExecutor,
  input: {
    readonly organizationId: string;
    readonly notificationId: string;
    readonly outcome: DispatchOutcome;
    readonly now: Date;
  },
): Promise<void> {
  const { outcome } = input;

  await db
    .insert(notificationSends)
    .values({
      organizationId: input.organizationId,
      notificationId: input.notificationId,
      channel: "slack",
      target: outcome.status === "quiet" ? NOTIFICATION_SEND_NO_TARGET : outcome.target,
      status: outcome.status,
      quietReason: outcome.status === "quiet" ? "no_channel" : null,
      failureReason: outcome.status === "failed" ? outcome.failureReason : null,
      messageRef: outcome.status === "sent" ? outcome.messageRef : null,
      sentAt: outcome.status === "sent" ? input.now : null,
    })
    .onConflictDoNothing({
      target: [
        notificationSends.notificationId,
        notificationSends.channel,
        notificationSends.target,
      ],
    });
}
