import {
  agentFirstContactSentence,
  genericNotificationSentence,
  keysRevokedSentence,
  toBlockKit,
} from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import {
  findUserNameById,
  readNotificationForDispatch,
  recordDispatchOutcome,
  type NotificationForDispatch,
} from "@growthmind/db";
import { SYSTEM_ACTOR, systemContextForOrganizationId } from "@growthmind/db/system";
import {
  describeError,
  notificationDispatchPayloadSchema,
  type DeliveryPoster,
  type NotificationSendFailureReason,
  type PostResult,
  type TenantContext,
} from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

export interface NotificationDispatchDeps {
  readonly db: ScopedDb;
  readonly posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null>;
  readonly logger: TaskLogger;
}

// Both surfaces call the same builder, so the sentence in Slack is the sentence in the bell.
async function sentenceFor(
  db: ScopedDb,
  notification: NotificationForDispatch,
  organizationName: string,
): Promise<string> {
  switch (notification.type) {
    case "keys_revoked": {
      // Resolved here rather than stored: a name in a row goes stale, and personal data
      // never enters a payload.
      const revokedByName =
        notification.actorUserId === null
          ? null
          : await findUserNameById(db, notification.actorUserId);

      return keysRevokedSentence({
        workspaceName: organizationName,
        revokedByName,
      });
    }
    case "agent_first_contact":
      return agentFirstContactSentence();
    case "finding_delivered":
      // Findings reach Slack through the delivery tick, which posts them itself and hands
      // the emit a copied receipt — a job for one would be a second path to the channel.
      return genericNotificationSentence();
  }
}

// The customer-facing reason is composed from the closed union the poster returns, never
// echoed from its message: a vendor's string carries internal ids.
function failureReasonOf(result: Extract<PostResult, { ok: false }>): NotificationSendFailureReason {
  return result.code;
}

// Lease-less in v1 (ADD D-1): idempotent by the unique send key, single-runner
// assumption; job 2 adds the claim lease and owns retry policy.
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

  const poster = await deps.posterFor(ctx);

  // A channel exists but its credential could not be opened. That is a broken connection,
  // not an absent one — recording it quiet would tell a connected org that Slack is not
  // connected, and quiet is terminal, so job 2's lease would never come back to it.
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
    return;
  }

  const sentence = await sentenceFor(deps.db, notification, ctx.organizationName);

  let result: PostResult;
  try {
    result = await poster.post({
      channelId: notification.channelId,
      blocks: toBlockKit([{ kind: "section", text: sentence }]),
      fallbackText: sentence,
    });
  } catch (error) {
    // The Slack HTTP port, never the database — the driver-safe describer is for the writes
    // around it (worker/__tests__/driver-error-discipline.test.ts).
    deps.logger.error(
      `notification dispatch: ${notificationId} threw while posting — ${describeError(error)}`,
    );
    await recordDispatchOutcome(deps.db, ctx, {
      notificationId,
      outcome: { status: "failed", target: notification.channelId, failureReason: "call_failed" },
      now,
    });
    return;
  }

  // A post failure records and completes rather than throwing: v1 has no retry policy, and
  // the bell's chip is what makes the failure honest to a reader.
  if (!result.ok) {
    deps.logger.error(
      `notification dispatch: ${notificationId} was not accepted by the channel — ${result.code}`,
    );
    await recordDispatchOutcome(deps.db, ctx, {
      notificationId,
      outcome: {
        status: "failed",
        target: notification.channelId,
        failureReason: failureReasonOf(result),
      },
      now,
    });
    return;
  }

  await recordDispatchOutcome(deps.db, ctx, {
    notificationId,
    outcome: { status: "sent", target: notification.channelId, messageRef: result.messageRef },
    now,
  });
}
