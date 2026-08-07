// notification:rescue (ADD D-4): one dispatch job per unsettled notification inside the
// window — the inverse of settled, never the quiet:no_channel literal — idempotent on a
// second run, silent for an unknown organization. RED in Wave 0: the task is a throwing
// stub, so every case fails on behaviour while the file typechecks against the real deps.
import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";

import { schema } from "@growthmind/db";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
  type TestDbHandle,
} from "@growthmind/db/testing";
import {
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_SEND_NO_TARGET,
  type NotificationQuietReason,
  type NotificationSendFailureReason,
} from "@growthmind/shared";

import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  loadRescue,
  loudPoster,
  runAllDispatchJobs,
  silentLogger,
  type MirrorWorkerDeps,
} from "../../../packages/db/__tests__/helpers/o051-contracts";

const NAMES = laneNames("o051-rescue-task");

const CHANNEL = "C0RESCUE9";

const DAY_MS = 24 * 60 * 60 * 1_000;

// A cold PGlite boot blows bun's 5s default; each test opens its own database so one
// test's captured jobs can never leak into another's counts.
const COLD_BOOT_BUDGET_MS = 60_000;

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

let orgCount = 0;

async function seedOrg(db: TestDb, label: string): Promise<SeededOrgWithOwner> {
  orgCount += 1;
  return seedOrgWithOwner(db, {
    orgName: NAMES.orgName(`${label}-${String(orgCount)}`),
    userName: NAMES.userName(label),
    email: NAMES.email(`${label}-${String(orgCount)}`),
  });
}

interface StrandReceipt {
  readonly status: "sent" | "failed" | "quiet";
  readonly quietReason?: NotificationQuietReason;
  readonly failureReason?: NotificationSendFailureReason;
  readonly createdAt?: Date;
}

async function seedStrand(
  db: TestDb,
  org: SeededOrgWithOwner,
  receipt: StrandReceipt,
): Promise<string> {
  const seeded = await seedNotification(db, {
    organizationId: org.organizationId,
    subjectId: randomUUID(),
    ...(receipt.createdAt === undefined ? {} : { createdAt: receipt.createdAt }),
  });

  await seedNotificationSend(db, {
    organizationId: org.organizationId,
    notificationId: seeded.id,
    status: receipt.status,
    quietReason: receipt.quietReason ?? null,
    failureReason: receipt.failureReason ?? null,
    target: receipt.status === "quiet" ? NOTIFICATION_SEND_NO_TARGET : CHANNEL,
    sentAt: receipt.status === "sent" ? new Date() : null,
  });

  return seeded.id;
}

function depsFor(db: TestDb): MirrorWorkerDeps {
  return { db, now: () => new Date(), logger: silentLogger };
}

async function runRescue(db: TestDb, organizationId: string): Promise<void> {
  const rescue = await loadRescue();
  await rescue({ organizationId }, depsFor(db));
}

async function dispatchedIdsFor(db: TestDb, organizationId: string): Promise<readonly string[]> {
  return dispatchJobsOf(await capturedJobs(db))
    .map(dispatchPayloadOf)
    .filter((payload) => payload.organizationId === organizationId)
    .map((payload) => payload.notificationId);
}

test("the sweep queues one dispatch job per unsettled notification, and skips sent, digest-deferred and out-of-window rows", async () => {
  const db = await openDb();
  const org = await seedOrg(db, "sweep");
  await connectSlackChannel(db, org, CHANNEL);

  const noChannel = await seedStrand(db, org, { status: "quiet", quietReason: "no_channel" });
  const notAuthorised = await seedStrand(db, org, {
    status: "failed",
    failureReason: "not_authorised",
  });
  const queueUnavailable = await seedStrand(db, org, {
    status: "failed",
    failureReason: "queue_unavailable",
  });
  const alreadySent = await seedStrand(db, org, { status: "sent" });
  const deferredToDigest = await seedStrand(db, org, { status: "quiet", quietReason: "digest" });
  const outsideWindow = await seedStrand(db, org, {
    status: "quiet",
    quietReason: "no_channel",
    createdAt: new Date(Date.now() - 31 * DAY_MS),
  });

  await runRescue(db, org.organizationId);

  const dispatched = await dispatchedIdsFor(db, org.organizationId);
  expect([...dispatched].toSorted()).toEqual(
    [noChannel, notAuthorised, queueUnavailable].toSorted(),
  );
  expect(dispatched).not.toContain(alreadySent);
  expect(dispatched).not.toContain(deferredToDigest);
  expect(dispatched).not.toContain(outsideWindow);

  // The emit-time job key shape, so a rescue job and the original emit's job collapse
  // rather than double-queue (D-4).
  for (const job of dispatchJobsOf(await capturedJobs(db))) {
    expect(job.jobKey).toBe(`${NOTIFICATION_DISPATCH_TASK}:${dispatchPayloadOf(job).notificationId}`);
  }
}, COLD_BOOT_BUDGET_MS);

test("a second run captures the same set and produces no duplicate posts downstream", async () => {
  const db = await openDb();
  const org = await seedOrg(db, "twice");
  await connectSlackChannel(db, org, CHANNEL);

  const noChannel = await seedStrand(db, org, { status: "quiet", quietReason: "no_channel" });
  const queueUnavailable = await seedStrand(db, org, {
    status: "failed",
    failureReason: "queue_unavailable",
  });

  await runRescue(db, org.organizationId);
  await runRescue(db, org.organizationId);

  const dispatched = await dispatchedIdsFor(db, org.organizationId);
  expect([...dispatched].toSorted()).toEqual([noChannel, queueUnavailable].toSorted());

  const recorder = loudPoster();
  await runAllDispatchJobs(db, recorder.poster);
  expect(recorder.posted).toHaveLength(2);

  // Rescuing again after the posts landed queues nothing new downstream: the settled
  // check and the lease make every duplicate free (D-4's idempotency claim).
  await runRescue(db, org.organizationId);
  await runAllDispatchJobs(db, recorder.poster);
  expect(recorder.posted).toHaveLength(2);

  const sends = (await db.select().from(schema.notificationSends)).filter(
    (row) => row.notificationId === noChannel,
  );
  expect(sends.filter((row) => row.status === "sent")).toHaveLength(1);
}, COLD_BOOT_BUDGET_MS);

test("an unknown organization completes cleanly and queues nothing", async () => {
  const db = await openDb();

  const rescue = await loadRescue();
  await expect(
    rescue({ organizationId: "org-never-existed" }, depsFor(db)),
  ).resolves.toBeUndefined();

  expect(dispatchJobsOf(await capturedJobs(db))).toEqual([]);
}, COLD_BOOT_BUDGET_MS);
