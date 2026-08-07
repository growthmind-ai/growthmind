import { randomUUID } from "node:crypto";

import {
  buildAgentFirstContactDedupKey,
  buildFindingDeliveredDedupKey,
  buildKeysRevokedDedupKey,
  credentialAad,
  encryptSecret,
  keyIdOf,
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_SEND_NO_TARGET,
  type CredentialKey,
} from "@growthmind/shared";
import { afterAll, describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";

import { emitNotification, type EmitNotificationInput } from "../../src/notifications/emit";
import { createApiKeysRepo } from "../../src/repositories/api-keys.repo";
import { apiKeys } from "../../src/schema/api-keys";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { notifications, notificationSends } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  recordPublishedTopics,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
  type TestDbHandle,
} from "../../src/testing";

const NAMES = laneNames("notification-emit");

const CHANNEL_ID = "C01AB2CD3EF";

const MESSAGE_REF = "1723040000.000100";

const SENT_AT = new Date("2026-08-06T12:00:00.000Z");

const KEY: CredentialKey = { bytes: Uint8Array.from({ length: 32 }, (_, index) => index) };

// Every test opens its own database: the enqueue-fault case NEEDS the default fixture (no
// graphile_worker schema), and a stub installed by an earlier test on a shared handle
// would silently turn that case into the queued path.
const handles: TestDbHandle[] = [];

async function openDb(): Promise<TestDb> {
  const handle = await createTestDb();
  handles.push(handle);
  return handle.db;
}

afterAll(async () => {
  await Promise.all(handles.map((handle) => handle.close()));
});

async function seedOrg(db: TestDb, label: string): Promise<SeededOrgWithOwner> {
  return seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
}

async function connectSlack(db: TestDb, org: SeededOrgWithOwner): Promise<void> {
  await createSlackConnectionsRepo(db, org.ctx).insertActive({
    channelId: CHANNEL_ID,
    workspaceName: "Fixture workspace",
    credentialCiphertext: encryptSecret(
      "xoxb-fixture-only-never-a-real-token",
      KEY,
      credentialAad(org.organizationId, "slack"),
    ),
    credentialKeyId: keyIdOf(KEY),
    connectedAt: new Date("2026-08-01T09:00:00.000Z"),
  });
}

function copiedInput(findingId: string): EmitNotificationInput {
  return {
    type: "finding_delivered",
    subjectKind: "finding",
    subjectId: findingId,
    actorUserId: null,
    payload: { type: "finding_delivered", v: 1 },
    dedupKey: buildFindingDeliveredDedupKey(findingId, CHANNEL_ID),
    slack: { kind: "copied", channelId: CHANNEL_ID, messageRef: MESSAGE_REF, sentAt: SENT_AT },
  };
}

function owedKeysRevokedInput(eventId: string, actorUserId: string): EmitNotificationInput {
  return {
    type: "keys_revoked",
    subjectKind: "agent_key",
    subjectId: eventId,
    actorUserId,
    payload: { type: "keys_revoked", v: 1 },
    dedupKey: buildKeysRevokedDedupKey(eventId),
    slack: { kind: "owed" },
  };
}

function owedFirstContactInput(keyId: string): EmitNotificationInput {
  return {
    type: "agent_first_contact",
    subjectKind: "agent_key",
    subjectId: keyId,
    actorUserId: null,
    payload: { type: "agent_first_contact", v: 1 },
    dedupKey: buildAgentFirstContactDedupKey(),
    slack: { kind: "owed" },
  };
}

async function notificationRowsFor(db: TestDb, organizationId: string) {
  return db.select().from(notifications).where(eq(notifications.organizationId, organizationId));
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

describe("emitNotification inserts once per (org, dedup_key)", () => {
  test("a conflict returns emitted:false and changes nothing — no send row, no NOTIFY, no job", async () => {
    const db = await openDb();
    const org = await seedOrg(db, "conflict");
    await stubGraphileAddJob(db);
    const recorder = recordPublishedTopics(db);
    const input = copiedInput(randomUUID());

    const first = await emitNotification(recorder.db, org.organizationId, input);
    const second = await emitNotification(recorder.db, org.organizationId, input);

    expect(first).toEqual({ emitted: true });
    expect(second).toEqual({ emitted: false });

    const rows = await notificationRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    if (!row) throw new Error("the first emit left no notification row");
    expect(await sendRowsFor(db, row.id)).toHaveLength(1);

    // Exactly the first emit's announce — a write that changed nothing wakes nobody (D3).
    expect(recorder.published).toEqual([
      { organizationId: org.organizationId, topic: "notifications" },
    ]);
    expect(await capturedJobs(db)).toEqual([]);
  });
});

describe("the copied arm records a post that already happened", () => {
  test("writes the sent Slack receipt at commit and queues no dispatch job", async () => {
    const db = await openDb();
    const org = await seedOrg(db, "copied");
    await stubGraphileAddJob(db);
    const recorder = recordPublishedTopics(db);
    const findingId = randomUUID();

    const result = await emitNotification(recorder.db, org.organizationId, copiedInput(findingId));
    expect(result).toEqual({ emitted: true });

    const rows = await notificationRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("emit left no notification row");

    expect(row.type).toBe("finding_delivered");
    expect(row.audience).toBe("org");
    expect(row.subjectKind).toBe("finding");
    expect(row.subjectId).toBe(findingId);
    expect(row.actorUserId).toBeNull();
    expect(row.dedupKey).toBe(buildFindingDeliveredDedupKey(findingId, CHANNEL_ID));

    const sends = await sendRowsFor(db, row.id);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the copied emit left no send row");

    expect(send.channel).toBe("slack");
    expect(send.target).toBe(CHANNEL_ID);
    expect(send.status).toBe("sent");
    expect(send.messageRef).toBe(MESSAGE_REF);
    expect(send.sentAt?.toISOString()).toBe(SENT_AT.toISOString());
    expect(send.quietReason).toBeNull();
    expect(send.failureReason).toBeNull();

    expect(await capturedJobs(db)).toEqual([]);
    expect(recorder.published).toEqual([
      { organizationId: org.organizationId, topic: "notifications" },
    ]);
  });
});

describe("the owed arm resolves the Slack leg at emit time", () => {
  test("no connection writes quiet: no_channel at commit, without the worker", async () => {
    const db = await openDb();
    const org = await seedOrg(db, "quiet");
    await stubGraphileAddJob(db);
    const recorder = recordPublishedTopics(db);
    const eventId = randomUUID();

    const result = await emitNotification(
      recorder.db,
      org.organizationId,
      owedKeysRevokedInput(eventId, org.userId),
    );
    expect(result).toEqual({ emitted: true });

    const rows = await notificationRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("emit left no notification row");
    expect(row.actorUserId).toBe(org.userId);

    // Silence has a receipt (AC-11's self-host path): the quiet row lands with the fact,
    // no worker anywhere in the loop.
    const sends = await sendRowsFor(db, row.id);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the quiet path left no send row");

    expect(send.channel).toBe("slack");
    expect(send.status).toBe("quiet");
    expect(send.quietReason).toBe("no_channel");
    expect(send.target).toBe(NOTIFICATION_SEND_NO_TARGET);
    expect(send.failureReason).toBeNull();

    expect(await capturedJobs(db)).toEqual([]);
    expect(recorder.published).toEqual([
      { organizationId: org.organizationId, topic: "notifications" },
    ]);
  });

  test("a connection queues notification:dispatch transactionally and writes no receipt yet", async () => {
    const db = await openDb();
    const org = await seedOrg(db, "queued");
    await connectSlack(db, org);
    await stubGraphileAddJob(db);
    const recorder = recordPublishedTopics(db);

    const result = await emitNotification(
      recorder.db,
      org.organizationId,
      owedFirstContactInput(randomUUID()),
    );
    expect(result).toEqual({ emitted: true });

    const rows = await notificationRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("emit left no notification row");
    expect(row.dedupKey).toBe(buildAgentFirstContactDedupKey());

    const jobs = await capturedJobs(db);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error("the owed emit queued no job");

    expect(job.task).toBe(NOTIFICATION_DISPATCH_TASK);
    expect(job.payload).toEqual({
      organizationId: org.organizationId,
      notificationId: row.id,
    });
    expect(job.jobKey).toBe(`notification:dispatch:${row.id}`);

    // The receipt is the dispatch task's to write — sent, failed, or quiet at post time.
    expect(await sendRowsFor(db, row.id)).toEqual([]);
    expect(recorder.published).toEqual([
      { organizationId: org.organizationId, topic: "notifications" },
    ]);
  });

  test("an enqueue fault leaves a failed queue_unavailable receipt, never a bare notification", async () => {
    // No stubGraphileAddJob here: the embedded database has no graphile_worker schema, so
    // enqueueJob returns false — the fresh-clone web boot before the worker's first run.
    const db = await openDb();
    const org = await seedOrg(db, "enqueue-fault");
    await connectSlack(db, org);
    const recorder = recordPublishedTopics(db);
    const eventId = randomUUID();

    const result = await emitNotification(
      recorder.db,
      org.organizationId,
      owedKeysRevokedInput(eventId, org.userId),
    );
    expect(result).toEqual({ emitted: true });

    const rows = await notificationRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("emit left no notification row");

    const sends = await sendRowsFor(db, row.id);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the enqueue fault left the notification bare");

    expect(send.channel).toBe("slack");
    expect(send.status).toBe("failed");
    expect(send.failureReason).toBe("queue_unavailable");
    expect(send.quietReason).toBeNull();
    expect(send.messageRef).toBeNull();

    expect(recorder.published).toEqual([
      { organizationId: org.organizationId, topic: "notifications" },
    ]);
  });
});

// The edge sweep's blocking pair: before the savepoint landed, a fault on the notification
// side rolled back the caller's write — a successful Slack post re-posted forever, and
// "revoke every key" left the keys live. The harms are not symmetric, so the emit is the
// side that gives way.
describe("a notification fault never undoes the fact it announces (D8)", () => {
  test("revokeEveryLive still revokes when the emit cannot write its row", async () => {
    const { db, close } = await createTestDb();
    try {
      const org = await seedOrgWithOwner(db, {
        orgName: "o051-emit-fault-org",
        userName: "o051-emit-fault-owner",
        email: "o051-emit-fault@example.com",
      });

      await createApiKeysRepo(db, org.ctx).mint({ name: "o051-emit-fault-key" });

      // An actor the `user` table has never held: the notification insert's foreign key
      // rejects it, which is a fault arriving from inside the emit exactly as a lagging
      // migration or a new constraint would (D13).
      const ghost = { ...org.ctx, userId: "o051-user-that-does-not-exist" };

      expect(await createApiKeysRepo(db, ghost).revokeEveryLive()).toBe(true);

      const live = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.organizationId, org.organizationId), isNull(apiKeys.revokedAt)));
      expect(live).toEqual([]);

      const emitted = await db
        .select()
        .from(notifications)
        .where(eq(notifications.organizationId, org.organizationId));
      expect(emitted).toEqual([]);
    } finally {
      await close();
    }
  });
});
