import { NOTIFICATION_DISPATCH_CLAIM_TTL_MS } from "@growthmind/core";
import { NOTIFICATION_SEND_NO_TARGET, NOTIFICATION_WINDOW_DAYS } from "@growthmind/shared";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { listUnsettledNotificationIds } from "../../src/services/notification-rescue.service";
import { notificationSends } from "../../src/schema/notifications";
import {
  createTestDb,
  laneNames,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

// ADD D-4: the sweep's predicate is the inverse of settled, never the `quiet: no_channel`
// literal — the commonest strand is a `failed` receipt whose credential could not be
// opened, and AC-1 alone cannot see it.

const NAMES = laneNames("notification-rescue-service");

const NOW = new Date();

const WINDOW_START = new Date(NOW.getTime() - NOTIFICATION_WINDOW_DAYS * 24 * 60 * 60 * 1_000);

const STALE_CLAIMS_BEFORE = new Date(NOW.getTime() - NOTIFICATION_DISPATCH_CLAIM_TTL_MS);

describe("the rescue sweep enumerates unsettled notifications inside the window and nothing else", () => {
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

  async function seedWithReceipt(
    org: SeededOrgWithOwner,
    receipt:
      | { status: "sent" }
      | { status: "failed"; failureReason: string }
      | { status: "quiet"; quietReason: string },
    createdAt?: Date,
  ): Promise<string> {
    const { id } = await seedNotification(db, {
      organizationId: org.organizationId,
      ...(createdAt === undefined ? {} : { createdAt }),
    });

    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: id,
      status: receipt.status,
      failureReason: "failureReason" in receipt ? receipt.failureReason : null,
      quietReason: "quietReason" in receipt ? receipt.quietReason : null,
      target: receipt.status === "quiet" ? NOTIFICATION_SEND_NO_TARGET : "C0RESCUE01",
      sentAt: receipt.status === "sent" ? NOW : null,
    });

    return id;
  }

  test("quiet no_channel and both failed arms are returned; sent, quiet digest, the too-old and the foreign are not (D7)", async () => {
    const org = await seedOrg("sweep");
    const other = await seedOrg("sweep-other");

    const strandedQuiet = await seedWithReceipt(org, {
      status: "quiet",
      quietReason: "no_channel",
    });
    const strandedCredential = await seedWithReceipt(org, {
      status: "failed",
      failureReason: "not_authorised",
    });
    const strandedBlip = await seedWithReceipt(org, {
      status: "failed",
      failureReason: "call_failed",
    });

    await seedWithReceipt(org, { status: "sent" });
    await seedWithReceipt(org, { status: "quiet", quietReason: "digest" });
    await seedWithReceipt(
      org,
      { status: "quiet", quietReason: "no_channel" },
      new Date(WINDOW_START.getTime() - 60_000),
    );
    const foreign = await seedWithReceipt(other, { status: "quiet", quietReason: "no_channel" });

    const ids = await listUnsettledNotificationIds(db, org.ctx, {
      since: WINDOW_START,
      staleClaimsBefore: STALE_CLAIMS_BEFORE,
    });

    expect([...ids].toSorted()).toEqual(
      [strandedQuiet, strandedCredential, strandedBlip].toSorted(),
    );

    // And the boundary read the other way: the other org's sweep sees only its own row.
    const foreignIds = await listUnsettledNotificationIds(db, other.ctx, {
      since: WINDOW_START,
      staleClaimsBefore: STALE_CLAIMS_BEFORE,
    });
    expect([...foreignIds]).toEqual([foreign]);
  });

  test("a pending row is stranded only once its lease expired", async () => {
    const org = await seedOrg("pending");

    const inFlight = await seedNotification(db, { organizationId: org.organizationId });
    await db.insert(notificationSends).values({
      organizationId: org.organizationId,
      notificationId: inFlight.id,
      channel: "slack",
      target: "C0RESCUE01",
      status: "pending",
      claimedAt: NOW,
      attempts: 1,
    });

    const abandoned = await seedNotification(db, { organizationId: org.organizationId });
    await db.insert(notificationSends).values({
      organizationId: org.organizationId,
      notificationId: abandoned.id,
      channel: "slack",
      target: "C0RESCUE01",
      status: "pending",
      claimedAt: new Date(STALE_CLAIMS_BEFORE.getTime() - 60_000),
      attempts: 1,
    });

    const ids = await listUnsettledNotificationIds(db, org.ctx, {
      since: WINDOW_START,
      staleClaimsBefore: STALE_CLAIMS_BEFORE,
    });

    expect([...ids]).toEqual([abandoned.id]);
  });

  test("a notification with no receipt at all is unsettled — the predicate is the inverse, not a literal", async () => {
    // The owed-queued arm writes no receipt; a wiped queue leaves exactly this shape.
    const org = await seedOrg("bare");
    const bare = await seedNotification(db, { organizationId: org.organizationId });

    const ids = await listUnsettledNotificationIds(db, org.ctx, {
      since: WINDOW_START,
      staleClaimsBefore: STALE_CLAIMS_BEFORE,
    });

    expect([...ids]).toEqual([bare.id]);
  });
});
