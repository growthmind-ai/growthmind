// D11 wires for ADD D-4: the rescue producers live inside the repository writes, the
// sweep's predicate is the inverse of settled, and the whole chain — strand, reconnect or
// recover, rescue job, dispatch, sent receipt — is driven end to end through the real
// entry points. RED in Wave 0: the producers and the rescue task do not exist yet.
import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { authoritativeSlackReceipt } from "@growthmind/core";
import { NOTIFICATION_SEND_NO_TARGET, type SlackReceiptFacts } from "@growthmind/shared";

import { createApiKeysRepo } from "../../src/repositories/api-keys.repo";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { notifications, notificationSends } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
  type TestDbHandle,
} from "../../src/testing";
import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  loadRescue,
  loudPoster,
  recordHealthOf,
  rescueJobKeyFor,
  rescueJobsFor,
  runAllDispatchJobs,
  silentLogger,
} from "../helpers/o051-contracts";

const NAMES = laneNames("wire-rescue");

const CHANNEL = "C0RESCUE001";

const handles: TestDbHandle[] = [];

async function openDb(): Promise<TestDb> {
  const handle = await createTestDb();
  handles.push(handle);
  await stubGraphileAddJob(handle.db);
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

async function driveKeysRevoked(db: TestDb, org: SeededOrgWithOwner): Promise<void> {
  const repo = createApiKeysRepo(db, org.ctx);
  await repo.mint({ name: "rescue-wire agent" });
  expect(await repo.revokeEveryLive()).toBe(true);
}

async function notificationOfType(db: TestDb, organizationId: string, type: "keys_revoked") {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), eq(notifications.type, type)));
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error(`the real emitter left no ${type} row`);
  return row;
}

async function sendFactsFor(db: TestDb, notificationId: string): Promise<SlackReceiptFacts[]> {
  const rows = await db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId))
    .orderBy(notificationSends.createdAt);

  return rows.map((row) => ({
    channel: row.channel,
    target: row.target,
    status: row.status,
    quietReason: row.quietReason,
    failureReason: row.failureReason,
    messageRef: row.messageRef,
    channelLabel: row.channelLabel,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
  }));
}

async function runRescueForOrg(db: TestDb, organizationId: string): Promise<void> {
  const rescue = await loadRescue();
  await rescue({ organizationId }, { db, now: () => new Date(), logger: silentLogger });
}

test("a rescued notification ends with a sent receipt and renders the sent chip", async () => {
  const db = await openDb();
  const org = await seedOrg(db, "reconnect");

  // A workspace with no channel: the emit resolves no delivery target, so the honest
  // receipt is quiet no_channel — the strand AC-1 names.
  await connectSlackChannel(db, org, null);
  await driveKeysRevoked(db, org);

  const stranded = await notificationOfType(db, org.organizationId, "keys_revoked");
  expect(
    (await sendFactsFor(db, stranded.id)).map((send) => [send.status, send.quietReason]),
  ).toEqual([["quiet", "no_channel"]]);

  // The producer under test: the repository write itself queues the rescue.
  const attached = await createSlackConnectionsRepo(db, org.ctx).attachChannel(CHANNEL, "growth");
  expect(attached).not.toBeNull();

  const rescueJobs = rescueJobsFor(await capturedJobs(db), org.organizationId);
  expect(rescueJobs).toHaveLength(1);
  expect(rescueJobs[0]?.jobKey).toBe(rescueJobKeyFor(org.organizationId));

  await runRescueForOrg(db, org.organizationId);
  await runAllDispatchJobs(db, loudPoster().poster);

  // Both receipts survive — the quiet one is history, the sent one is the outcome — and
  // the pure precedence rule picks the sent one for the chip (AC-7).
  const facts = await sendFactsFor(db, stranded.id);
  expect(facts.map((send) => send.status)).toContain("quiet");
  expect(facts.map((send) => send.status)).toContain("sent");
  expect(authoritativeSlackReceipt(facts)?.status).toBe("sent");
});

test("a notification stranded by a broken credential is rescued when the connection recovers", async () => {
  const db = await openDb();
  const org = await seedOrg(db, "recover");
  await connectSlackChannel(db, org, CHANNEL);

  await driveKeysRevoked(db, org);
  const stranded = await notificationOfType(db, org.organizationId, "keys_revoked");

  // A null poster is the credential that could not be opened — a different branch from a
  // rejecting post, and the receipt it leaves is failed/not_authorised, which the settled
  // predicate must treat as unsettled (the arm AC-1 cannot see).
  await runAllDispatchJobs(db, null);
  expect(
    (await sendFactsFor(db, stranded.id)).map((send) => [send.status, send.failureReason]),
  ).toEqual([["failed", "not_authorised"]]);

  // Recovery is the first successful post after a failure. `recovered` here also pins
  // that the null-poster dispatch recorded the failing edge — without it there is no
  // failing state to recover from and no rescue ever fires.
  const recordHealth = recordHealthOf(createSlackConnectionsRepo(db, org.ctx));
  const transition = await recordHealth({
    health: "healthy",
    reasonCode: null,
    reasonMessage: null,
    checkedAt: new Date(),
  });
  expect(transition).toBe("recovered");

  const rescueJobs = rescueJobsFor(await capturedJobs(db), org.organizationId);
  expect(rescueJobs).toHaveLength(1);
  expect(rescueJobs[0]?.jobKey).toBe(rescueJobKeyFor(org.organizationId));

  await runRescueForOrg(db, org.organizationId);
  await runAllDispatchJobs(db, loudPoster().poster);

  expect(authoritativeSlackReceipt(await sendFactsFor(db, stranded.id))?.status).toBe("sent");
});

test("a quiet: digest notification is never re-dispatched by the rescue path", async () => {
  const db = await openDb();
  const org = await seedOrg(db, "digest-settled");
  await connectSlackChannel(db, org, CHANNEL);

  // The gathered-for-the-summary receipt: settled for dispatch, owned by the digest task.
  const [settled] = await db
    .insert(notifications)
    .values({
      organizationId: org.organizationId,
      type: "backfill_complete",
      audience: "org",
      subjectKind: "source_connection",
      subjectId: randomUUID(),
      actorUserId: null,
      payload: { type: "backfill_complete", v: 1, sessionsTouched: 3, eventsPersisted: 12 },
      dedupKey: `backfill_complete:${randomUUID()}`,
    })
    .returning();
  if (!settled) throw new Error("seeding the settled notification returned no row");
  await db.insert(notificationSends).values({
    organizationId: org.organizationId,
    notificationId: settled.id,
    channel: "slack",
    target: NOTIFICATION_SEND_NO_TARGET,
    status: "quiet",
    quietReason: "digest",
  });

  // A genuinely stranded control row, so the sweep returning nothing for the digest row
  // is a decision rather than a sweep that saw nothing at all.
  const [strandedControl] = await db
    .insert(notifications)
    .values({
      organizationId: org.organizationId,
      type: "keys_revoked",
      audience: "org",
      subjectKind: "agent_key",
      subjectId: randomUUID(),
      actorUserId: null,
      payload: { type: "keys_revoked", v: 1 },
      dedupKey: `keys_revoked:${randomUUID()}`,
    })
    .returning();
  if (!strandedControl) throw new Error("seeding the stranded control returned no row");
  await db.insert(notificationSends).values({
    organizationId: org.organizationId,
    notificationId: strandedControl.id,
    channel: "slack",
    target: CHANNEL,
    status: "failed",
    failureReason: "call_failed",
  });

  await runRescueForOrg(db, org.organizationId);

  const queuedIds = dispatchJobsOf(await capturedJobs(db)).map(
    (job) => dispatchPayloadOf(job).notificationId,
  );
  expect(queuedIds).toContain(strandedControl.id);
  expect(queuedIds).not.toContain(settled.id);

  const loud = loudPoster();
  await runAllDispatchJobs(db, loud.poster);

  expect(loud.posted).toHaveLength(1);
  expect(
    (await sendFactsFor(db, settled.id)).map((send) => [send.status, send.quietReason]),
  ).toEqual([["quiet", "digest"]]);
});
