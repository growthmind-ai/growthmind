import { randomUUID } from "node:crypto";

import {
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_SEND_NO_TARGET,
  type NotificationPayload,
  type NotificationQuietReason,
  type NotificationSendFailureReason,
  type NotificationSubjectKind,
  type NotificationType,
} from "@growthmind/shared";
import { logger } from "@growthmind/shared";
import { and, eq, sql } from "drizzle-orm";

import { enqueueJob } from "../jobs/enqueue";
import { publishLive } from "../live/publish";
import { inTransaction } from "../repositories/crud";
import { describeDriverError } from "../repositories/driver-error";
import { toSlackConnectionSummary } from "../repositories/slack-connections.repo";
import type { ScopedExecutor } from "../repositories/types";
import { notifications, notificationSends } from "../schema/notifications";
import { slackConnections } from "../schema/slack-connections";
import { isDeliveryTarget } from "../services/delivery-channel-guard";

// The Slack leg is resolved at emit time (ADD D-1): "copied" records a post that already
// happened; "owed" resolves the org's delivery target inside the caller's transaction —
// no connection writes the quiet receipt, a connection queues the dispatch job, and an
// enqueue fault writes the failed receipt, so a committed notification can never exist
// without its Slack receipt.
export type EmitNotificationSlack =
  | {
      readonly kind: "copied";
      readonly channelId: string;
      readonly messageRef: string | null;
      readonly sentAt: Date;
    }
  | { readonly kind: "owed" };

export interface EmitNotificationInput {
  readonly type: NotificationType;
  readonly subjectKind: NotificationSubjectKind;
  readonly subjectId: string;

  // A member user id or null — never a machine principal (the FK enforces it).
  readonly actorUserId: string | null;

  readonly payload: NotificationPayload;

  // From the dedup builders only; no display string can enter a key by signature.
  readonly dedupKey: string;

  readonly slack: EmitNotificationSlack;

  // When present, the insert is additionally guarded by "no notification of this type for
  // this subject in this organization within the window" — one mechanism for every
  // per-subject cooldown (ADD §3.2). Dedup stays the once-ever guard beside it.
  readonly cooldownSeconds?: number;
}

interface SendReceipt {
  readonly target: string;
  readonly status: "sent" | "failed" | "quiet";
  readonly quietReason?: NotificationQuietReason;
  readonly failureReason?: NotificationSendFailureReason;
  readonly messageRef?: string | null;
  readonly sentAt?: Date;
}

// Conflict-tolerant by the unique (notification, channel, target) key: a receipt that
// already exists is the receipt, never a throw inside the caller's transaction.
async function writeSendRow(
  db: ScopedExecutor,
  organizationId: string,
  notificationId: string,
  receipt: SendReceipt,
): Promise<void> {
  await db
    .insert(notificationSends)
    .values({
      organizationId,
      notificationId,
      channel: "slack",
      target: receipt.target,
      status: receipt.status,
      quietReason: receipt.quietReason ?? null,
      failureReason: receipt.failureReason ?? null,
      messageRef: receipt.messageRef ?? null,
      sentAt: receipt.sentAt ?? null,
    })
    .onConflictDoNothing({
      target: [
        notificationSends.notificationId,
        notificationSends.channel,
        notificationSends.target,
      ],
    });
}

// getActiveForOrg's read with the org filter written out: this seam holds no TenantContext
// (ADD D-2 — both callers derive `organizationId` from a DB-returned row), so the repo
// factory cannot be used, but what counts as a delivery target stays `isDeliveryTarget`'s.
async function activeConnectionOf(db: ScopedExecutor, organizationId: string) {
  const [row] = await db
    .select()
    .from(slackConnections)
    .where(
      and(eq(slackConnections.organizationId, organizationId), eq(slackConnections.isActive, true)),
    )
    .limit(1);

  return row ? toSlackConnectionSummary(row) : null;
}

async function writeSlackLeg(
  db: ScopedExecutor,
  organizationId: string,
  notificationId: string,
  slack: EmitNotificationSlack,
): Promise<void> {
  if (slack.kind === "copied") {
    await writeSendRow(db, organizationId, notificationId, {
      target: slack.channelId,
      status: "sent",
      messageRef: slack.messageRef,
      sentAt: slack.sentAt,
    });
    return;
  }

  const connection = await activeConnectionOf(db, organizationId);

  if (connection === null || !isDeliveryTarget(connection)) {
    await writeSendRow(db, organizationId, notificationId, {
      target: NOTIFICATION_SEND_NO_TARGET,
      status: "quiet",
      quietReason: "no_channel",
    });
    return;
  }

  const queued = await enqueueJob(db, {
    task: NOTIFICATION_DISPATCH_TASK,
    payload: { organizationId, notificationId },
    jobKey: `notification:dispatch:${notificationId}`,
  });

  // D-1 amendment 2: the fact commits with a failed receipt rather than bare, and the
  // sentence for the code is rendered at read.
  if (!queued) {
    await writeSendRow(db, organizationId, notificationId, {
      target: connection.channelId,
      status: "failed",
      failureReason: "queue_unavailable",
    });
  }
}

// Module-internal to @growthmind/db, never exported from the barrel: every job-1 emitter
// lives inside this package, and `organizationId` is the one sanctioned exception to "no
// repo method accepts an org id" — both callers derive it from a DB-returned row.
// `db` is the CALLER's transaction executor; emit never opens a transaction of its own.
export async function emitNotification(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitNotificationInput,
): Promise<{ readonly emitted: boolean }> {
  // A savepoint, so this can never undo the fact it is announcing. The notification and its
  // receipt still commit or vanish together — that is what the class invariant needs — but a
  // fault on this side rolls back to here, not through the caller's write. The harms are not
  // symmetric: a missing bell row is a missing bell row, while the other direction leaves
  // keys live after "revoke every key", or re-posts a finding Slack already has.
  try {
    return await inTransaction(db, (tx) => writeNotification(tx, organizationId, input));
  } catch (error) {
    logger.error("notifications: the fact was written and its notification was not", {
      organizationId,
      type: input.type,
      reason: describeDriverError(error),
    });
    return { emitted: false };
  }
}

type RawExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
};

// One statement, no read-then-write: the cooldown guard is the insert-select's own WHERE,
// served by notifications_org_type_subject_created_at_idx, and the dedup conflict stays as
// the once-ever guard beside it. Raw SQL because the query builder cannot express an
// insert-from-select with a conflict clause; the id is minted here because the schema's
// $defaultFn does not run outside the builder.
async function insertGuardedByCooldown(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitNotificationInput,
  cooldownSeconds: number,
): Promise<string | null> {
  const id = randomUUID();

  const result = await (db as unknown as RawExecutor).execute(sql`
    insert into ${notifications} ("id", "organization_id", "type", "audience", "subject_kind", "subject_id", "actor_user_id", "payload", "dedup_key")
    select ${id}, ${organizationId}, ${input.type}, 'org', ${input.subjectKind}, ${input.subjectId}, ${input.actorUserId}, ${JSON.stringify(input.payload)}::jsonb, ${input.dedupKey}
    where not exists (
      select 1 from ${notifications}
      where ${notifications.organizationId} = ${organizationId}
        and ${notifications.type} = ${input.type}
        and ${notifications.subjectId} = ${input.subjectId}
        and ${notifications.createdAt} > now() - make_interval(secs => ${cooldownSeconds})
    )
    on conflict ("organization_id", "dedup_key") do nothing
    returning "id"
  `);

  return result.rows.length > 0 ? id : null;
}

async function insertNotificationRow(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitNotificationInput,
): Promise<string | null> {
  if (input.cooldownSeconds !== undefined) {
    return insertGuardedByCooldown(db, organizationId, input, input.cooldownSeconds);
  }

  const [row] = await db
    .insert(notifications)
    .values({
      organizationId,
      type: input.type,
      audience: "org",
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      actorUserId: input.actorUserId,
      payload: input.payload,
      dedupKey: input.dedupKey,
    })
    .onConflictDoNothing({
      target: [notifications.organizationId, notifications.dedupKey],
    })
    .returning();

  return row?.id ?? null;
}

async function writeNotification(
  db: ScopedExecutor,
  organizationId: string,
  input: EmitNotificationInput,
): Promise<{ readonly emitted: boolean }> {
  const notificationId = await insertNotificationRow(db, organizationId, input);

  // D3: a conflict or a still-cooling subject is a fact the org already holds — no send
  // row, no job, no publish.
  if (notificationId === null) {
    return { emitted: false };
  }

  await writeSlackLeg(db, organizationId, notificationId, input.slack);

  // NOTIFY defers to commit inside a transaction, so open pages hear about the fact only
  // once it is real.
  await publishLive(db, { organizationId, topic: "notifications" });

  return { emitted: true };
}
