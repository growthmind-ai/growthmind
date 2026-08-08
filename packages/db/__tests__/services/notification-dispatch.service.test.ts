import { NOTIFICATION_DISPATCH_MAX_ATTEMPTS } from "@growthmind/core";
import {
  NOTIFICATION_SEND_FAILURE_REASONS,
  NOTIFICATION_SEND_NO_TARGET,
  isConnectionShapedFailure,
  isRetryableSendFailure,
  type NotificationSendFailureReason,
} from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  claimNotificationSend,
  readNotificationForDispatch,
  recordDispatchOutcome,
} from "../../src/services/notification-dispatch.service";
import { notificationSends } from "../../src/schema/notifications";
import { slackConnections } from "../../src/schema/slack-connections";
import {
  createTestDb,
  laneNames,
  PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
  PLACEHOLDER_CREDENTIAL_KEY_ID,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

// ADD D-1: the lease, the supersede guard and the attempt increment are one atomic
// INSERT … ON CONFLICT DO UPDATE … WHERE reclaimable — claimForPost's shape on the
// receipt table. Same winner/loser return: the loser observes the held row.

const NAMES = laneNames("notification-dispatch-service");

const TARGET = "C0DISPATCH01";

const CLAIMED_AT = new Date("2026-08-07T09:00:00.000Z");

const RETRY_AT = new Date("2026-08-07T09:06:00.000Z");

// Before every claim this suite makes, so nothing reads as abandoned unless a test says so.
const NOTHING_EXPIRED = new Date(CLAIMED_AT.getTime() - 60 * 60 * 1_000);

// After them, so every live claim reads as abandoned.
const EVERYTHING_EXPIRED = new Date(CLAIMED_AT.getTime() + 60 * 60 * 1_000);

describe("the notification dispatch lease", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
    return seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(label),
      email: NAMES.email(label),
    });
  }

  async function seedOwedNotification(org: SeededOrgWithOwner): Promise<string> {
    const { id } = await seedNotification(db, { organizationId: org.organizationId });
    return id;
  }

  async function seedFailedSend(
    org: SeededOrgWithOwner,
    notificationId: string,
    failureReason: NotificationSendFailureReason,
    attempts: number,
  ): Promise<void> {
    await db.insert(notificationSends).values({
      organizationId: org.organizationId,
      notificationId,
      channel: "slack",
      target: TARGET,
      status: "failed",
      failureReason,
      attempts,
    });
  }

  async function sendRowsOf(notificationId: string) {
    return db
      .select()
      .from(notificationSends)
      .where(eq(notificationSends.notificationId, notificationId));
  }

  test("a dispatch claim is exclusive: two attempts produce one post (AC-3)", async () => {
    const org = await seedOrg("exclusive");
    const notificationId = await seedOwedNotification(org);
    const input = {
      notificationId,
      target: TARGET,
      claimedAt: CLAIMED_AT,
      staleClaimsBefore: NOTHING_EXPIRED,
    };

    const first = await claimNotificationSend(db, org.ctx, input);
    const second = await claimNotificationSend(db, org.ctx, input);

    expect(first.claimed).toBe(true);
    if (!first.claimed) throw new Error("the first claim was not granted");
    expect(first.row.status).toBe("pending");
    expect(first.row.attempts).toBe(1);
    expect(first.row.claimedAt?.getTime()).toBe(CLAIMED_AT.getTime());

    // The loser observes the held lease rather than being told nothing (crud.ts's shape).
    expect(second.claimed).toBe(false);
    expect(second.claimed ? null : second.row?.id).toBe(first.row.id);
    expect(second.claimed ? null : second.row?.status).toBe("pending");
    expect(second.claimed ? null : second.row?.attempts).toBe(1);
  });

  test("an expired claim is reclaimable and increments attempts; a live one is not (AC-4)", async () => {
    const org = await seedOrg("expired");
    const notificationId = await seedOwedNotification(org);

    const first = await claimNotificationSend(db, org.ctx, {
      notificationId,
      target: TARGET,
      claimedAt: CLAIMED_AT,
      staleClaimsBefore: NOTHING_EXPIRED,
    });
    expect(first.claimed).toBe(true);

    const live = await claimNotificationSend(db, org.ctx, {
      notificationId,
      target: TARGET,
      claimedAt: RETRY_AT,
      staleClaimsBefore: NOTHING_EXPIRED,
    });
    expect(live.claimed).toBe(false);

    const retaken = await claimNotificationSend(db, org.ctx, {
      notificationId,
      target: TARGET,
      claimedAt: RETRY_AT,
      staleClaimsBefore: EVERYTHING_EXPIRED,
    });
    expect(retaken.claimed).toBe(true);
    if (!retaken.claimed) throw new Error("the expired claim was not retaken");
    expect(retaken.row.attempts).toBe(2);
    expect(retaken.row.status).toBe("pending");
    expect(retaken.row.claimedAt?.getTime()).toBe(RETRY_AT.getTime());
  });

  test("the claim refuses once the attempt cap is spent, and grants one attempt below it", async () => {
    const org = await seedOrg("cap");
    const spent = await seedOwedNotification(org);
    const below = await seedOwedNotification(org);
    await seedFailedSend(org, spent, "call_failed", NOTIFICATION_DISPATCH_MAX_ATTEMPTS);
    await seedFailedSend(org, below, "call_failed", NOTIFICATION_DISPATCH_MAX_ATTEMPTS - 1);

    const refused = await claimNotificationSend(db, org.ctx, {
      notificationId: spent,
      target: TARGET,
      claimedAt: CLAIMED_AT,
      staleClaimsBefore: NOTHING_EXPIRED,
    });
    expect(refused.claimed).toBe(false);
    expect(refused.claimed ? null : refused.row?.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);

    const granted = await claimNotificationSend(db, org.ctx, {
      notificationId: below,
      target: TARGET,
      claimedAt: CLAIMED_AT,
      staleClaimsBefore: NOTHING_EXPIRED,
    });
    expect(granted.claimed).toBe(true);
    if (!granted.claimed) throw new Error("the below-cap claim was not granted");
    expect(granted.row.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);
    expect(granted.row.status).toBe("pending");
  });

  test("only retryable failures are reclaimable — driven through isRetryableSendFailure, not a restated list (AC-5)", async () => {
    const org = await seedOrg("retryable");

    for (const reason of NOTIFICATION_SEND_FAILURE_REASONS) {
      const notificationId = await seedOwedNotification(org);
      await seedFailedSend(org, notificationId, reason, 1);

      const result = await claimNotificationSend(db, org.ctx, {
        notificationId,
        target: TARGET,
        claimedAt: CLAIMED_AT,
        staleClaimsBefore: NOTHING_EXPIRED,
      });

      expect({ reason, claimed: result.claimed }).toEqual({
        reason,
        claimed: isRetryableSendFailure(reason),
      });
    }
  });

  test("a sent receipt supersedes a failed one and a failed write never clobbers a sent one (AC-6)", async () => {
    const org = await seedOrg("supersede");
    const notificationId = await seedOwedNotification(org);
    await seedFailedSend(org, notificationId, "call_failed", 1);

    await recordDispatchOutcome(db, org.ctx, {
      notificationId,
      outcome: { status: "sent", target: TARGET, messageRef: "1785481299.000200" },
      now: RETRY_AT,
    });

    const afterSent = await sendRowsOf(notificationId);
    expect(afterSent).toHaveLength(1);
    expect(afterSent[0]?.status).toBe("sent");
    expect(afterSent[0]?.sentAt).not.toBeNull();
    expect(afterSent[0]?.failureReason).toBeNull();

    // `attempts` counts claims and nothing else (CR-3): the supersede leaves it where the
    // claim put it, or the ratified cap of 5 quietly becomes ~3 real posts.
    expect(afterSent[0]?.attempts).toBe(1);

    await recordDispatchOutcome(db, org.ctx, {
      notificationId,
      outcome: { status: "failed", target: TARGET, failureReason: "call_failed" },
      now: new Date(RETRY_AT.getTime() + 60_000),
    });

    // The same statement is the supersede guard: an outcome only ever improves.
    const afterLateFailure = await sendRowsOf(notificationId);
    expect(afterLateFailure).toHaveLength(1);
    expect(afterLateFailure[0]?.status).toBe("sent");
    expect(afterLateFailure[0]?.sentAt?.getTime()).toBe(afterSent[0]?.sentAt?.getTime());
    expect(afterLateFailure[0]?.failureReason).toBeNull();
    expect(afterLateFailure[0]?.messageRef).toBe("1785481299.000200");
    expect(afterLateFailure[0]?.attempts).toBe(1);
  });

  test("settled is reason-aware: no_channel is not settled, digest is (AC-1/AC-2's precondition)", async () => {
    const org = await seedOrg("settled");

    const strandable = await seedOwedNotification(org);
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: strandable,
      status: "quiet",
      quietReason: "no_channel",
      target: NOTIFICATION_SEND_NO_TARGET,
    });

    const deferred = await seedOwedNotification(org);
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: deferred,
      status: "quiet",
      quietReason: "digest",
      target: NOTIFICATION_SEND_NO_TARGET,
    });

    // A reconnect must rescue the first; the digest task owns the second.
    const strandableRead = await readNotificationForDispatch(db, org.ctx, strandable);
    const deferredRead = await readNotificationForDispatch(db, org.ctx, deferred);

    expect(strandableRead?.settled).toBe(false);
    expect(deferredRead?.settled).toBe(true);
  });

  // O-051 job 2 regression: the reclaim arm once asked `health === "healthy"`, and a
  // reconnect leaves health at its `validating` default — so non-retryable receipts stayed
  // stranded on the commonest repair, and nothing ever set the connection healthy.
  describe("which reclaim arm applies follows the connection's world (ADD D-4)", () => {
    async function seedActiveConnection(
      org: SeededOrgWithOwner,
      health: "validating" | "healthy" | "failing",
    ): Promise<void> {
      await db.insert(slackConnections).values({
        organizationId: org.organizationId,
        channelId: TARGET,
        channelName: "growth",
        credentialCiphertext: PLACEHOLDER_CREDENTIAL_CIPHERTEXT,
        credentialKeyId: PLACEHOLDER_CREDENTIAL_KEY_ID,
        isActive: true,
        health,
      });
    }

    // Non-retryable AND at the cap: claimable by the rescue arm alone, never the retry arm.
    async function seedSpentStrand(org: SeededOrgWithOwner): Promise<string> {
      const notificationId = await seedOwedNotification(org);
      await seedFailedSend(
        org,
        notificationId,
        "not_authorised",
        NOTIFICATION_DISPATCH_MAX_ATTEMPTS,
      );
      return notificationId;
    }

    function claimInput(notificationId: string) {
      return {
        notificationId,
        target: TARGET,
        claimedAt: CLAIMED_AT,
        staleClaimsBefore: NOTHING_EXPIRED,
      };
    }

    test("a reconnected connection still at its validating default rescues a non-retryable failure past the cap", async () => {
      const org = await seedOrg("rescue-validating");
      const notificationId = await seedSpentStrand(org);
      await seedActiveConnection(org, "validating");

      const result = await claimNotificationSend(db, org.ctx, claimInput(notificationId));

      expect(result.claimed).toBe(true);
      if (!result.claimed) throw new Error("the rescue claim was not granted");
      expect(result.row.status).toBe("pending");
      expect(result.row.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS + 1);
      expect(result.row.claimedAt?.getTime()).toBe(CLAIMED_AT.getTime());
    });

    test("a healthy connection rescues the same strand — the rescue arm's direct coverage", async () => {
      const org = await seedOrg("rescue-healthy");
      const notificationId = await seedSpentStrand(org);
      await seedActiveConnection(org, "healthy");

      const result = await claimNotificationSend(db, org.ctx, claimInput(notificationId));

      expect(result.claimed).toBe(true);
      if (!result.claimed) throw new Error("the rescue claim was not granted");
      expect(result.row.status).toBe("pending");
      expect(result.row.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS + 1);
    });

    test("a failing connection is no repair: the strand stays refused", async () => {
      const org = await seedOrg("rescue-failing");
      const notificationId = await seedSpentStrand(org);
      await seedActiveConnection(org, "failing");

      const result = await claimNotificationSend(db, org.ctx, claimInput(notificationId));

      expect(result.claimed).toBe(false);
      expect(result.claimed ? null : result.row?.status).toBe("failed");
      expect(result.claimed ? null : result.row?.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);
    });

    test("no connection at all is no repair: the cap keeps holding for an org that never had a channel", async () => {
      const org = await seedOrg("rescue-absent");
      const notificationId = await seedSpentStrand(org);

      const result = await claimNotificationSend(db, org.ctx, claimInput(notificationId));

      expect(result.claimed).toBe(false);
      expect(result.claimed ? null : result.row?.status).toBe("failed");
      expect(result.claimed ? null : result.row?.attempts).toBe(NOTIFICATION_DISPATCH_MAX_ATTEMPTS);
    });

    // CR-2: a connection repair cannot fix a message our own renderer built wrong — a
    // reclaimed `rejected` row would repost the same refused message on every recovery,
    // and its next failure would raise a false slack_disconnected into a working channel.
    test("a repaired connection reclaims only connection-shaped failures — driven through isConnectionShapedFailure, not a restated list", async () => {
      const org = await seedOrg("rescue-shape");
      await seedActiveConnection(org, "healthy");

      for (const reason of NOTIFICATION_SEND_FAILURE_REASONS) {
        const notificationId = await seedOwedNotification(org);
        await seedFailedSend(org, notificationId, reason, NOTIFICATION_DISPATCH_MAX_ATTEMPTS);

        const result = await claimNotificationSend(db, org.ctx, claimInput(notificationId));

        expect({ reason, claimed: result.claimed }).toEqual({
          reason,
          claimed: reason === "queue_unavailable" || isConnectionShapedFailure(reason),
        });
      }
    });
  });
});
