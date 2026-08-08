import {
  agentFirstContactSentence,
  analysisFailingSentence,
  ANALYSIS_FAILING_RUN_COUNT,
  backfillCompleteSentence,
  buildDigestMessage,
  dispatchClaimsExpireBefore,
  genericNotificationSentence,
  keyCreatedSentence,
  keysRevokedSentence,
  NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
  slackDisconnectedSentence,
  toBlockKit,
} from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  claimNotificationSend,
  createSlackConnectionsRepo,
  findProjectNameForDispatch,
  findUserNameById,
  listNotificationsByIds,
  readNotificationForDispatch,
  recordDispatchOutcome,
  type DigestMemberNotification,
  type NotificationForDispatch,
} from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextForOrganizationId } from "@growthmind/db/system";
import {
  describeError,
  isRetryableSendFailure,
  notificationDispatchPayloadSchema,
  parseNotificationPayload,
  type DeliveryPoster,
  type NotificationSendFailureReason,
  type PostFailureCode,
  type PostResult,
  type TenantContext,
} from "@growthmind/shared";

import { isolated, type TaskLogger } from "../task-logger";

export interface NotificationDispatchDeps {
  readonly db: ScopedDb;
  readonly posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null>;
  readonly logger: TaskLogger;
}

interface RenderableNotification {
  readonly type: NotificationForDispatch["type"];
  readonly subjectId: string;
  readonly actorUserId: string | null;
  readonly payload: unknown;
}

// Both surfaces call the same builder, so the sentence in Slack is the sentence in the
// bell. Names resolve here rather than from a stored payload — a name in a row goes
// stale, and personal data never enters one. A missing subject degrades to the generic
// sentence (D5).
async function sentenceFor(
  db: ScopedDb,
  ctx: TenantContext,
  notification: RenderableNotification,
  healthReasonCode: PostFailureCode | null,
): Promise<string> {
  switch (notification.type) {
    case "keys_revoked": {
      const revokedByName =
        notification.actorUserId === null
          ? null
          : await findUserNameById(db, notification.actorUserId);

      return keysRevokedSentence({
        workspaceName: ctx.organizationName,
        revokedByName,
      });
    }
    case "agent_first_contact":
      return agentFirstContactSentence();
    case "finding_delivered":
      // Findings reach Slack through the delivery tick, which posts them itself and hands
      // the emit a copied receipt — a job for one would be a second path to the channel.
      return genericNotificationSentence();
    case "key_created": {
      const createdByName =
        notification.actorUserId === null
          ? null
          : await findUserNameById(db, notification.actorUserId);

      return keyCreatedSentence({ createdByName });
    }
    case "backfill_complete": {
      const parsed = parseNotificationPayload(notification.payload);

      if (!parsed.ok || parsed.payload.type !== "backfill_complete") {
        return genericNotificationSentence();
      }

      return backfillCompleteSentence({
        sessionsTouched: parsed.payload.sessionsTouched,
        eventsPersisted: parsed.payload.eventsPersisted,
      });
    }
    case "slack_disconnected":
      return slackDisconnectedSentence(healthReasonCode);
    case "analysis_failing": {
      const projectName = await findProjectNameForDispatch(db, ctx, notification.subjectId);

      if (projectName === null) {
        return genericNotificationSentence();
      }

      return analysisFailingSentence({
        failed: ANALYSIS_FAILING_RUN_COUNT,
        of: ANALYSIS_FAILING_RUN_COUNT,
        projectName,
      });
    }
    case "digest":
      // The digest's multi-section shape lives in messageFor; a digest that somehow
      // reaches this one-section path still says something rather than throwing.
      return genericNotificationSentence();
  }
}

interface RenderedPost {
  readonly blocks: unknown[];
  readonly fallbackText: string;
}

// One rename inside the render (ADD §4.4): the six one-section types keep their shape
// byte for byte, and `digest` composes the existing per-type builders into a
// multi-section message — a render detail, never a second delivery path (D-8).
async function messageFor(
  db: ScopedDb,
  ctx: TenantContext,
  notification: NotificationForDispatch,
): Promise<RenderedPost> {
  if (notification.type === "digest") {
    const parsed = parseNotificationPayload(notification.payload);

    if (parsed.ok && parsed.payload.type === "digest") {
      const members = await listNotificationsByIds(db, ctx, parsed.payload.notificationIds);
      const byId = new Map<string, DigestMemberNotification>(
        members.map((member) => [member.id, member]),
      );

      const sentences: string[] = [];
      for (const id of parsed.payload.notificationIds) {
        const member = byId.get(id);
        sentences.push(
          member === undefined
            ? genericNotificationSentence()
            : await sentenceFor(db, ctx, member, null),
        );
      }

      const message = buildDigestMessage({ sentences, totalCount: parsed.payload.totalCount });

      return { blocks: toBlockKit(message.blocks), fallbackText: message.fallbackText };
    }
  }

  const sentence = await sentenceFor(db, ctx, notification, notification.healthReasonCode);

  return { blocks: toBlockKit([{ kind: "section", text: sentence }]), fallbackText: sentence };
}

// The customer-facing reason is composed from the closed union the poster returns, never
// echoed from its message: a vendor's string carries internal ids.
function failureReasonOf(result: Extract<PostResult, { ok: false }>): NotificationSendFailureReason {
  return result.code;
}

// D8: a health-badge write can never kill the post whose receipt is already committed.
async function recordHealthEdge(
  db: ScopedDb,
  ctx: TenantContext,
  logger: TaskLogger,
  notificationId: string,
  edge: { readonly health: "healthy" | "failing"; readonly reasonCode: PostFailureCode | null },
  now: Date,
): Promise<void> {
  await isolated(
    logger,
    `notification dispatch: ${notificationId} posted but the connection's health badge could not be updated`,
    () =>
      createSlackConnectionsRepo(db, ctx).recordHealth({
        health: edge.health,
        reasonCode: edge.reasonCode,
        reasonMessage: null,
        checkedAt: now,
      }),
  );
}

// The dispatch task, rewritten around the lease (ADD §4.4): claim → render → post →
// record outcome → health edge → throw only for a retryable failure with attempts left,
// after the receipt is committed. Writing `failed` also releases the lease, so the TTL is
// only ever exercised by a crash between claim and outcome.
export async function runNotificationDispatch(
  payload: unknown,
  deps: NotificationDispatchDeps,
): Promise<void> {
  // Before any side effect, so a Graphile retry of a malformed job is safe.
  const { organizationId, notificationId } = notificationDispatchPayloadSchema.parse(payload);

  const ctx = await systemContextForOrganizationId(
    deps.db,
    SYSTEM_ACTOR.NOTIFICATION_DISPATCH,
    organizationId,
  );

  if (ctx === null) {
    deps.logger.info(
      `notification dispatch: organization ${organizationId} is no longer there, so this job is done`,
    );
    return;
  }

  const notification = await readNotificationForDispatch(deps.db, ctx, notificationId);

  if (notification === null) {
    deps.logger.info(
      `notification dispatch: ${notificationId} is no longer there, so this job is done`,
    );
    return;
  }

  // The outer guard: one successful post per notification, ever (D-4's predicate).
  if (notification.settled) {
    deps.logger.info(
      `notification dispatch: ${notificationId} already has its receipt, so this run posted nothing`,
    );
    return;
  }

  const now = new Date();

  if (notification.channelId === null) {
    await recordDispatchOutcome(deps.db, ctx, {
      notificationId,
      outcome: { status: "quiet" },
      now,
    });
    return;
  }

  const claim = await claimNotificationSend(deps.db, ctx, {
    notificationId,
    target: notification.channelId,
    claimedAt: now,
    staleClaimsBefore: dispatchClaimsExpireBefore(now),
  });

  // A lease someone else holds is not an error; that runner owns the outcome.
  if (!claim.claimed) {
    deps.logger.info(
      `notification dispatch: ${notificationId} is leased to another runner, so this run posted nothing`,
    );
    return;
  }

  const poster = await deps.posterFor(ctx);

  // A channel exists but its credential could not be opened. That is a broken connection,
  // not an absent one — recording it quiet would tell a connected org that Slack is not
  // connected, and quiet is terminal, so the rescue would never come back to it. The
  // failing edge is what closes the retry arm mid-outage; recovery re-opens it (D-3).
  if (poster === null) {
    await recordDispatchOutcome(deps.db, ctx, {
      notificationId,
      outcome: {
        status: "failed",
        target: notification.channelId,
        failureReason: "not_authorised",
      },
      now,
    });
    await recordHealthEdge(
      deps.db,
      ctx,
      deps.logger,
      notificationId,
      { health: "failing", reasonCode: "not_authorised" },
      now,
    );
    return;
  }

  const message = await messageFor(deps.db, ctx, notification);

  let failure: NotificationSendFailureReason | null = null;
  let result: PostResult | null = null;
  try {
    result = await poster.post({
      channelId: notification.channelId,
      blocks: message.blocks,
      fallbackText: message.fallbackText,
    });
  } catch (error) {
    // The Slack HTTP port, never the database — the driver-safe describer is for the writes
    // around it (worker/__tests__/driver-error-discipline.test.ts).
    deps.logger.error(
      `notification dispatch: ${notificationId} threw while posting — ${describeError(error)}`,
    );
    failure = "call_failed";
  }

  if (result !== null && !result.ok) {
    deps.logger.error(
      `notification dispatch: ${notificationId} was not accepted by the channel — ${result.code}`,
    );
    failure = failureReasonOf(result);
  }

  if (failure !== null) {
    await recordDispatchOutcome(deps.db, ctx, {
      notificationId,
      outcome: { status: "failed", target: notification.channelId, failureReason: failure },
      now,
    });
    await recordHealthEdge(
      deps.db,
      ctx,
      deps.logger,
      notificationId,
      { health: "failing", reasonCode: failure === "queue_unavailable" ? null : failure },
      now,
    );

    // The receipt is already committed, so what Graphile retries is honest — and the
    // thrown message carries the closed-union code, never vendor text (D-2).
    if (isRetryableSendFailure(failure) && claim.row.attempts < NOTIFICATION_DISPATCH_MAX_ATTEMPTS) {
      throw new Error(
        `notification dispatch: ${notificationId} failed with ${failure} and is owed a retry`,
      );
    }
    return;
  }

  if (result === null || !result.ok) {
    return;
  }

  await recordDispatchOutcome(deps.db, ctx, {
    notificationId,
    outcome: {
      status: "sent",
      target: notification.channelId,
      messageRef: result.messageRef,
      channelLabel: notification.channelName,
    },
    now,
  });
  await recordHealthEdge(
    deps.db,
    ctx,
    deps.logger,
    notificationId,
    { health: "healthy", reasonCode: null },
    now,
  );
}
