import {
  NOTIFICATION_SEND_NO_TARGET,
  type NotificationSendFailureReason,
  type NotificationType,
  type TenantContext,
} from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { scoped } from "../repositories/scope";
import { toSlackConnectionSummary } from "../repositories/slack-connections.repo";
import type { ScopedExecutor } from "../repositories/types";
import { notifications, notificationSends } from "../schema/notifications";
import { slackConnections } from "../schema/slack-connections";
import { isDeliveryTarget } from "./delivery-channel-guard";

export interface NotificationForDispatch {
  readonly id: string;
  readonly type: NotificationType;
  readonly subjectId: string;
  readonly actorUserId: string | null;

  // A receipt already recorded for this channel: the post happened, or was decided against,
  // on an earlier run of this job (D4).
  readonly settled: boolean;

  // Resolved at post time rather than at emit: an org that disconnected in between gets the
  // honest quiet receipt, and the chip explains it.
  readonly channelId: string | null;
}

// The worker's read model for one queued notification, scoped by the context the caller
// built from the payload's organization — a job naming another tenant's row matches nothing.
export async function readNotificationForDispatch(
  db: ScopedExecutor,
  ctx: TenantContext,
  notificationId: string,
): Promise<NotificationForDispatch | null> {
  const s = scoped(db, ctx);

  const [row] = await db
    .select()
    .from(notifications)
    .where(s.owned(notifications, eq(notifications.id, notificationId)))
    .limit(1);

  if (!row) {
    return null;
  }

  const sends = await db
    .select({ status: notificationSends.status })
    .from(notificationSends)
    .where(
      s.owned(
        notificationSends,
        and(
          eq(notificationSends.notificationId, notificationId),
          eq(notificationSends.channel, "slack"),
        ),
      ),
    );

  const [connection] = await db
    .select()
    .from(slackConnections)
    .where(s.owned(slackConnections, eq(slackConnections.isActive, true)))
    .limit(1);

  const summary = connection ? toSlackConnectionSummary(connection) : null;

  return {
    id: row.id,
    type: row.type,
    subjectId: row.subjectId,
    actorUserId: row.actorUserId,
    settled: sends.some((send) => send.status === "sent" || send.status === "quiet"),
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
  ctx: TenantContext,
  input: {
    readonly notificationId: string;
    readonly outcome: DispatchOutcome;
    readonly now: Date;
  },
): Promise<void> {
  const s = scoped(db, ctx);
  const { outcome } = input;

  await db
    .insert(notificationSends)
    .values({
      ...s.stamp,
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
