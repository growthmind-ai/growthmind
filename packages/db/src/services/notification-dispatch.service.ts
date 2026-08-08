import { NOTIFICATION_DISPATCH_MAX_ATTEMPTS } from "@growthmind/core";
import {
  NOTIFICATION_SEND_NO_TARGET,
  NOTIFICATION_SEND_FAILURE_REASONS,
  isConnectionShapedFailure,
  isRetryableSendFailure,
  type NotificationSendFailureReason,
  type NotificationSendStatus,
  type NotificationType,
  type PostFailureCode,
  type TenantContext,
} from "@growthmind/shared";
import { and, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";

import { orgCrud } from "../repositories/crud";
import { scoped, type Scope } from "../repositories/scope";
import { toSlackConnectionSummary } from "../repositories/slack-connections.repo";
import type { ScopedExecutor } from "../repositories/types";
import { notifications, notificationSends } from "../schema/notifications";
import { projects } from "../schema/projects";
import { slackConnections } from "../schema/slack-connections";
import { isDeliveryTarget } from "./delivery-channel-guard";

export interface NotificationForDispatch {
  readonly id: string;
  readonly type: NotificationType;
  readonly subjectId: string;
  readonly actorUserId: string | null;

  // Stored shape, parsed at render (D5): a row can carry any shape ever written.
  readonly payload: unknown;

  // A receipt already recorded for this channel: the post happened, or was decided against,
  // on an earlier run of this job (D4).
  readonly settled: boolean;

  // Resolved at post time rather than at emit: an org that disconnected in between gets the
  // honest quiet receipt, and the chip explains it.
  readonly channelId: string | null;

  // The connection's name at post time, written into the receipt so it stays
  // self-describing after a repoint or a disconnect (FR-4 req 2).
  readonly channelName: string | null;

  // The stored code the slack_disconnected sentence is built from; never the vendor text.
  readonly healthReasonCode: PostFailureCode | null;
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
    .select({ status: notificationSends.status, quietReason: notificationSends.quietReason })
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
    payload: row.payload,

    // Reason-aware (ADD D-4): a `quiet: no_channel` receipt does not settle the outcome —
    // a reconnect must be able to rescue it — while `quiet: digest` does, because the
    // summary owns that row and the dispatcher must never post it individually.
    settled: sends.some(
      (send) =>
        send.status === "sent" || (send.status === "quiet" && send.quietReason === "digest"),
    ),
    channelId: summary !== null && isDeliveryTarget(summary) ? summary.channelId : null,
    channelName: summary?.channelName ?? null,
    healthReasonCode: connection?.healthReasonCode ?? null,
  };
}

export interface DigestMemberNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly subjectId: string;
  readonly actorUserId: string | null;
  readonly payload: unknown;
}

// The digest render's member read (ADD D-8): ids come from the frozen payload, and the
// rows resolve at render so no sentence or name can go stale inside a stored summary.
export async function listNotificationsByIds(
  db: ScopedExecutor,
  ctx: TenantContext,
  ids: readonly string[],
): Promise<readonly DigestMemberNotification[]> {
  if (ids.length === 0) {
    return [];
  }

  const s = scoped(db, ctx);

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      subjectId: notifications.subjectId,
      actorUserId: notifications.actorUserId,
      payload: notifications.payload,
    })
    .from(notifications)
    .where(s.owned(notifications, inArray(notifications.id, [...ids])));

  return rows;
}

// The analysis_failing sentence names the project; a deleted one degrades to the generic
// sentence at the caller (job 1's D5 behaviour).
export async function findProjectNameForDispatch(
  db: ScopedExecutor,
  ctx: TenantContext,
  projectId: string,
): Promise<string | null> {
  const s = scoped(db, ctx);

  const [row] = await db
    .select({ name: projects.name })
    .from(projects)
    .where(s.owned(projects, eq(projects.id, projectId)))
    .limit(1);

  return row?.name ?? null;
}

// What the winner of a claim holds. `attempts` is the authoritative count because the
// claim statement's own predicate enforces the cap, so the caller never re-decides it.
export interface NotificationSendClaim {
  readonly id: string;
  readonly target: string;
  readonly status: NotificationSendStatus;
  readonly attempts: number;
  readonly claimedAt: Date | null;
}

// The loser re-reads the held row rather than being told nothing, so "someone else has
// this lease" is observable instead of indistinguishable from "there was no row".
export type NotificationSendClaimResult =
  | { readonly claimed: true; readonly row: NotificationSendClaim }
  | { readonly claimed: false; readonly row: NotificationSendClaim | null };

export interface ClaimNotificationSendInput {
  readonly notificationId: string;
  readonly target: string;
  readonly claimedAt: Date;

  // Claims older than this are abandoned, not in flight.
  readonly staleClaimsBefore: Date;
}

const RETRYABLE_FAILURE_REASONS = NOTIFICATION_SEND_FAILURE_REASONS.filter((reason) =>
  isRetryableSendFailure(reason),
);

// A live lease is never takeable; one claimed and never resolved is (deliveries' shape).
// Composed through `sql` rather than `or`, which widens to `SQL | undefined` and cannot
// satisfy the non-optional `setWhere` — a claim with no predicate would overwrite a live row.
function abandonedPending(staleClaimsBefore: Date): SQL {
  return sql`(${eq(notificationSends.status, "pending")} and ${lt(
    notificationSends.claimedAt,
    staleClaimsBefore,
  )})`;
}

// The retry arm (ADD D-2): within an unchanged world only a retryable failure may be
// re-attempted, and the cap is enforced inside the statement, never by a read-then-decide.
function retryReclaimable(staleClaimsBefore: Date): SQL {
  return sql`(((${eq(notificationSends.status, "failed")} and ${inArray(
    notificationSends.failureReason,
    RETRYABLE_FAILURE_REASONS,
  )}) or ${abandonedPending(staleClaimsBefore)}) and ${lt(
    notificationSends.attempts,
    NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
  )})`;
}

// A repaired connection cures only what the connection broke (CR-2): a message-shaped
// failure is our own renderer's, and reclaiming it would repost the same refused message
// after every recovery. A null reason is reclaimable so an unknown code cannot strand a row.
const CONNECTION_CURABLE_FAILURE_REASONS = NOTIFICATION_SEND_FAILURE_REASONS.filter(
  (reason) => reason === "queue_unavailable" || isConnectionShapedFailure(reason),
);

// The rescue arm (ADD D-4): once the org's connection is currently healthy, a
// connection-shaped failed receipt describes a world that no longer exists — the code and
// the spent cap gated a retry loop that is over, so neither may strand the row past the
// recovery.
function rescueReclaimable(staleClaimsBefore: Date): SQL {
  return sql`((${eq(notificationSends.status, "failed")} and (${isNull(
    notificationSends.failureReason,
  )} or ${inArray(
    notificationSends.failureReason,
    CONNECTION_CURABLE_FAILURE_REASONS,
  )})) or ${abandonedPending(staleClaimsBefore)})`;
}

// A live connection that is not `failing` is the signal that the world changed since a
// failed receipt was written, so the receipt describes something no longer true and the row
// may be claimed again. `healthy` alone was too narrow and stranded the commonest repair:
// reconnecting the same channel leaves health at its `validating` default, and nothing sets
// it healthy until some unrelated post happens to succeed. No connection at all is not a
// repair — the cap keeps holding there.
async function orgConnectionRepaired(db: ScopedExecutor, s: Scope): Promise<boolean> {
  const [row] = await db
    .select({ health: slackConnections.health })
    .from(slackConnections)
    .where(s.owned(slackConnections, eq(slackConnections.isActive, true)))
    .limit(1);

  return row !== undefined && row.health !== "failing";
}

function toClaim(row: typeof notificationSends.$inferSelect): NotificationSendClaim {
  return {
    id: row.id,
    target: row.target,
    status: row.status,
    attempts: row.attempts,
    claimedAt: row.claimedAt,
  };
}

// One statement: the lease, the supersede guard and the attempt increment are the same
// INSERT … ON CONFLICT DO UPDATE … WHERE reclaimable, so an outcome can only ever improve
// and the cap is enforced inside the write rather than by a read-then-decide. Which
// predicate applies is derived here, from the connection's recorded health, so no caller
// has to remember to say "this is a rescue" — the row's world says it.
export async function claimNotificationSend(
  db: ScopedExecutor,
  ctx: TenantContext,
  input: ClaimNotificationSendInput,
): Promise<NotificationSendClaimResult> {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, notificationSends);

  // The conflict target carries no organization column, so the org filter goes inside the
  // predicate: a foreign notification id then updates zero rows instead of relying on the
  // caller having read org-scoped first. This function is barrel-exported.
  const reclaimable = sql`(${s.org(notificationSends)} and ${
    (await orgConnectionRepaired(db, s))
      ? rescueReclaimable(input.staleClaimsBefore)
      : retryReclaimable(input.staleClaimsBefore)
  })`;

  const result = await c.claim(
    {
      notificationId: input.notificationId,
      channel: "slack",
      target: input.target,
      status: "pending",
      claimedAt: input.claimedAt,
      attempts: 1,
    },
    {
      target: [
        notificationSends.notificationId,
        notificationSends.channel,
        notificationSends.target,
      ],
      setWhere: reclaimable,
      set: {
        status: "pending",
        claimedAt: input.claimedAt,

        attempts: sql`${notificationSends.attempts} + 1`,

        quietReason: null,
        failureReason: null,
      },
      fetch: [
        and(
          eq(notificationSends.notificationId, input.notificationId),
          eq(notificationSends.channel, "slack"),
          eq(notificationSends.target, input.target),
        ),
      ],
    },
  );

  if (result.claimed && result.row) {
    return { claimed: true, row: toClaim(result.row) };
  }

  return { claimed: false, row: result.row ? toClaim(result.row) : null };
}

export type DispatchOutcome =
  | {
      readonly status: "sent";
      readonly target: string;
      readonly messageRef: string | null;

      // The connection's channel name at send time, so the receipt stays self-describing
      // after a repoint or a disconnect.
      readonly channelLabel?: string | null;
    }
  | {
      readonly status: "failed";
      readonly target: string;
      readonly failureReason: NotificationSendFailureReason;
    }
  | { readonly status: "quiet" };

const OUTCOME_RANK = { pending: 0, quiet: 1, failed: 2, sent: 3 } as const;

// The stored row's place on the same ladder, computed in SQL so the supersede decision
// happens inside the statement.
const storedOutcomeRank = sql`case ${notificationSends.status} when 'sent' then 3 when 'failed' then 2 when 'quiet' then 1 else 0 end`;

// The same key the claim uses, and a set that only ever improves: a sent receipt is never
// clobbered by a late failure, and a retry that raced an earlier run records nothing twice.
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

  const columns = {
    status: outcome.status,
    quietReason: outcome.status === "quiet" ? ("no_channel" as const) : null,
    failureReason: outcome.status === "failed" ? outcome.failureReason : null,
    messageRef: outcome.status === "sent" ? outcome.messageRef : null,
    channelLabel: outcome.status === "sent" ? (outcome.channelLabel ?? null) : null,
    sentAt: outcome.status === "sent" ? input.now : null,
  };

  await db
    .insert(notificationSends)
    .values({
      ...s.stamp,
      notificationId: input.notificationId,
      channel: "slack",
      target: outcome.status === "quiet" ? NOTIFICATION_SEND_NO_TARGET : outcome.target,
      attempts: 1,
      ...columns,
    })
    .onConflictDoUpdate({
      target: [
        notificationSends.notificationId,
        notificationSends.channel,
        notificationSends.target,
      ],
      // No attempts increment here (CR-3): the column counts claims alone. Every claimed
      // path already counted at the claim, and doubling it spent the ratified cap of 5 in
      // three real posts.
      set: columns,

      // Org-filtered for the same reason as the claim: the conflict target names no
      // organization, so the write defends itself rather than trusting its caller.
      setWhere: sql`(${s.org(notificationSends)} and ${storedOutcomeRank} < ${OUTCOME_RANK[outcome.status]})`,
    });
}
