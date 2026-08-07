// D11 wire (ADD §4 seam 1): the REAL createDeliveriesRepo().markPosted is the emitter of
// finding_delivered — a producer test against emitNotification proves nothing about this
// seam. RED in Wave 0 because the seam edit does not exist yet; every fixture below is
// satisfiable by construction against ADD §§2–4.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  buildFindingDeliveredDedupKey,
  NOTIFICATION_DISPATCH_TASK,
  RENDERED_MESSAGE_VERSION,
  type RenderedMessage,
} from "@growthmind/shared";

import {
  createDeliveriesRepo,
  type ClaimDeliveryInput,
} from "../../src/repositories/deliveries.repo";
import type { SignatureHex } from "../../src/signatures/hex";
import { notifications, notificationSends } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  recordPublishedTopics,
  seedOrgWithOwner,
  seedProject,
  stubGraphileAddJob,
  type LiveRecorder,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("wire-finding-delivered");

const CLAIMED_AT = new Date("2026-08-06T09:00:00.000Z");
const POSTED_AT = new Date("2026-08-06T09:00:05.000Z");
const NOTHING_EXPIRED = new Date(CLAIMED_AT.getTime() - 60 * 60 * 1_000);

const RENDERED: RenderedMessage = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [{ kind: "section", text: "*/checkout*\nThe payment step is losing sessions" }],
  text: "/checkout\nThe payment step is losing sessions",
  legibility: { characters: 43, lines: 2 },
};

function testSignature(seed: string): SignatureHex {
  return seed.repeat(64).slice(0, 64) as unknown as SignatureHex;
}

// `deliveries_channel_message_uidx` is globally unique over (channel_id, message_ref) —
// the interaction resolver depends on it — so every test posts into its own channel with
// its own ref rather than colliding across beds on the shared database.
let bedCount = 0;

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  // Installed so "no dispatch job" below is an observation, not a missing capture table.
  await stubGraphileAddJob(db);
});

afterAll(async () => {
  await close();
});

interface Bed {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly channel: string;
  readonly refFor: (n: number) => string;
  readonly recorder: LiveRecorder;
  readonly repo: ReturnType<typeof createDeliveriesRepo>;
  readonly claimInput: (findingId: string) => ClaimDeliveryInput;
}

async function bedFor(label: string): Promise<Bed> {
  bedCount += 1;
  const channel = `C0WIREFIND${String(bedCount)}`;

  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const recorder = recordPublishedTopics(db);

  return {
    org,
    projectId: project.id,
    channel,
    refFor: (n) => `17854812${String(bedCount).padStart(2, "0")}.${String(n).padStart(6, "0")}`,
    recorder,
    repo: createDeliveriesRepo(recorder.db, org.ctx),
    claimInput: (findingId) => ({
      projectId: project.id,
      findingId,
      signature: testSignature("a1b2"),
      channelId: channel,
      claimedAt: CLAIMED_AT,
      staleClaimsBefore: NOTHING_EXPIRED,
    }),
  };
}

async function notificationRowsFor(organizationId: string) {
  return db.select().from(notifications).where(eq(notifications.organizationId, organizationId));
}

async function sendRowsFor(notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

function notificationsTopicFor(recorder: LiveRecorder, organizationId: string) {
  return recorder.published.filter(
    (payload) => payload.topic === "notifications" && payload.organizationId === organizationId,
  );
}

async function dispatchJobsFor(organizationId: string) {
  return (await capturedJobs(db)).filter(
    (job) =>
      job.task === NOTIFICATION_DISPATCH_TASK &&
      (job.payload as { organizationId?: string }).organizationId === organizationId,
  );
}

describe("markPosted is the finding_delivered emitter (D11 wire)", () => {
  test("one claimed post writes one notification keyed on the delivery identity, with the sent receipt copied and no dispatch job", async () => {
    const bed = await bedFor("copied");
    const findingId = "finding-copied";

    const claim = await bed.repo.claimForPost(bed.claimInput(findingId));
    expect(claim.claimed).toBe(true);

    const marked = await bed.repo.markPosted({
      findingId,
      channelId: bed.channel,
      postedAt: POSTED_AT,
      messageRef: bed.refFor(1),
      renderedMessage: RENDERED,
    });
    expect(marked?.status).toBe("posted");

    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("markPosted emitted no notification row");

    expect(row.type).toBe("finding_delivered");
    expect(row.subjectKind).toBe("finding");
    expect(row.subjectId).toBe(findingId);
    expect(row.actorUserId).toBeNull();
    expect(row.audience).toBe("org");
    expect(row.dedupKey).toBe(buildFindingDeliveredDedupKey(findingId, bed.channel));

    // The receipt is copied from the post that already happened — no second Slack path.
    const sends = await sendRowsFor(row.id);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the copied leg left no send row");
    expect(send.channel).toBe("slack");
    expect(send.target).toBe(bed.channel);
    expect(send.status).toBe("sent");
    expect(send.messageRef).toBe(bed.refFor(1));
    expect(send.sentAt?.toISOString()).toBe(POSTED_AT.toISOString());

    expect(await dispatchJobsFor(bed.org.organizationId)).toEqual([]);
  });

  test("the write publishes the notifications topic, observed only after markPosted resolved", async () => {
    const bed = await bedFor("notify");
    const findingId = "finding-notify";

    await bed.repo.claimForPost(bed.claimInput(findingId));
    await bed.repo.markPosted({
      findingId,
      channelId: bed.channel,
      postedAt: POSTED_AT,
      messageRef: bed.refFor(1),
      renderedMessage: RENDERED,
    });

    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toEqual([
      { organizationId: bed.org.organizationId, topic: "notifications" },
    ]);

    // The existing first_run announce stays byte-identical beside the new emit (ADD §4).
    expect(
      bed.recorder.published.filter(
        (payload) =>
          payload.topic === "first_run" && payload.organizationId === bed.org.organizationId,
      ),
    ).toHaveLength(1);
  });

  test("a second identical markPosted adds nothing — no row, no send, no publish (D4 re-mark)", async () => {
    const bed = await bedFor("remark");
    const findingId = "finding-remark";

    await bed.repo.claimForPost(bed.claimInput(findingId));
    const post = {
      findingId,
      channelId: bed.channel,
      postedAt: POSTED_AT,
      messageRef: bed.refFor(1),
      renderedMessage: RENDERED,
    };

    await bed.repo.markPosted(post);
    await bed.repo.markPosted(post);

    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("markPosted emitted no notification row");
    expect(await sendRowsFor(row.id)).toHaveLength(1);

    // "A write that changed nothing wakes nobody": exactly the first mark's publish.
    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toHaveLength(1);
    expect(await dispatchJobsFor(bed.org.organizationId)).toEqual([]);
  });

  test("markFailed emits nothing, and the eventual successful re-post emits exactly once", async () => {
    const bed = await bedFor("failed-then-posted");
    const findingId = "finding-failed-then-posted";

    await bed.repo.claimForPost(bed.claimInput(findingId));
    await bed.repo.markFailed({
      findingId,
      channelId: bed.channel,
      failedAt: POSTED_AT,
      reason: "The channel could not be reached.",
    });

    expect(await notificationRowsFor(bed.org.organizationId)).toEqual([]);
    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toEqual([]);

    // The retry claims the failed row back and posts: one notification, at success time,
    // because no emit happened at the failure (ADD D-4).
    const reclaim = await bed.repo.claimForPost(bed.claimInput(findingId));
    expect(reclaim.claimed).toBe(true);
    await bed.repo.markPosted({
      findingId,
      channelId: bed.channel,
      postedAt: new Date(POSTED_AT.getTime() + 60_000),
      messageRef: bed.refFor(2),
      renderedMessage: RENDERED,
    });

    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupKey).toBe(buildFindingDeliveredDedupKey(findingId, bed.channel));
    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toHaveLength(1);
  });
});
