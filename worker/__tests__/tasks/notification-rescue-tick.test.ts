// notification:rescue-tick (ADD D-4, trigger 3): the producer for the receipts no write
// will ever follow. Fans out one collapsing rescue job per org with Slack connected, and
// is the ONLY thing that can see a web-only boot's queue_unavailable strand or an expired
// dispatch lease — which is why the strand case below runs the tick and never calls the
// rescue task directly. RED in Wave 0: the tick is a throwing stub.
import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";

import { NOTIFICATION_RESCUE_TICK_INTERVAL_MS } from "@growthmind/core";
import { createApiKeysRepo, schema } from "@growthmind/db";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedNotification,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
  type TestDbHandle,
} from "@growthmind/db/testing";
import { NOTIFICATION_RESCUE_TASK } from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  loadRescue,
  loudPoster,
  rescueJobKeyFor,
  rescueJobsFor,
  runAllDispatchJobs,
  silentLogger,
  type MirrorWorkerDeps,
} from "../../../packages/db/__tests__/helpers/o051-contracts";
import { crontab } from "../../src/index";
import { TASK } from "../../src/task-names";

const NAMES = laneNames("o051-rescue-tick");

const CHANNEL = "C0TICK001";

const TICK_OWNER = "O-051 task 3.3 (worker/src/tasks/notification-rescue-tick.ts, ADD D-4)";

const COLD_BOOT_BUDGET_MS = 60_000;

type RunNotificationRescueTick = (deps: MirrorWorkerDeps) => Promise<void>;

const loadRescueTick = (): Promise<RunNotificationRescueTick> =>
  loadUnderConstruction<RunNotificationRescueTick>({
    modulePath: underConstructionSpecifier("worker/src/tasks/notification-rescue-tick"),
    exportName: "runNotificationRescueTick",
    ownedBy: TICK_OWNER,
  });

const handles: TestDbHandle[] = [];

async function openDb(options: { readonly stub: boolean }): Promise<TestDb> {
  const handle = await createTestDb();
  handles.push(handle);
  if (options.stub) {
    await stubGraphileAddJob(handle.db);
  }
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

async function runTick(db: TestDb): Promise<void> {
  const tick = await loadRescueTick();
  await tick({ db, now: () => new Date(), logger: silentLogger });
}

// Executes the rescue jobs the tick queued — with the tick's own payloads, so the chain
// under test is tick → fan-out → sweep, never a hand-built rescue call.
async function drainRescueJobs(db: TestDb): Promise<void> {
  const rescue = await loadRescue();
  for (const job of (await capturedJobs(db)).filter(
    (candidate) => candidate.task === NOTIFICATION_RESCUE_TASK,
  )) {
    await rescue(job.payload, { db, now: () => new Date(), logger: silentLogger });
  }
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  const rows = await db.select().from(schema.notificationSends);
  return rows.filter((row) => row.notificationId === notificationId);
}

test("the tick fans out one collapsing rescue job per org with Slack connected, and none for the rest", async () => {
  const db = await openDb({ stub: true });
  const connected = await seedOrg(db, "connected");
  const unconnected = await seedOrg(db, "unconnected");
  await connectSlackChannel(db, connected, CHANNEL);

  await runTick(db);
  await runTick(db);

  // Two ticks leave one queued job because the job key collapses (D-4's fan-out shape).
  const jobs = await capturedJobs(db);
  const forConnected = rescueJobsFor(jobs, connected.organizationId);
  expect(forConnected).toHaveLength(1);
  expect(forConnected[0]?.jobKey).toBe(rescueJobKeyFor(connected.organizationId));

  expect(rescueJobsFor(jobs, unconnected.organizationId)).toEqual([]);
}, COLD_BOOT_BUDGET_MS);

test("a notification stranded by a web-only boot is delivered once the worker starts", async () => {
  // No graphile_worker schema yet: this database IS the web-only boot, where the worker
  // has never run and enqueueJob returns false (§9 residual, closed by the producer).
  const db = await openDb({ stub: false });
  const org = await seedOrg(db, "web-boot");
  await connectSlackChannel(db, org, CHANNEL);

  // The real emitter, through the real repository write — the emit resolves a delivery
  // target, fails to queue, and records the honest failed receipt.
  const keys = createApiKeysRepo(db, org.ctx);
  await keys.mint({ name: "o051 web-boot agent" });
  expect(await keys.revokeEveryLive()).toBe(true);

  const stranded = (await db.select().from(schema.notifications)).filter(
    (row) => row.type === "keys_revoked",
  );
  expect(stranded).toHaveLength(1);
  const strandedId = stranded[0]?.id ?? "";

  expect(
    (await sendRowsFor(db, strandedId)).map((row) => [row.status, row.failureReason]),
  ).toEqual([["failed", "queue_unavailable"]]);

  // The worker starts: the queue exists now, and nothing else has ever been queued on it —
  // no dispatch job survived from emit time, so only the tick can produce the rescue.
  await stubGraphileAddJob(db);
  expect(dispatchJobsOf(await capturedJobs(db))).toEqual([]);

  await runTick(db);
  await drainRescueJobs(db);

  const recorder = loudPoster();
  await runAllDispatchJobs(db, recorder.poster);

  const statuses = (await sendRowsFor(db, strandedId)).map((row) => row.status);
  expect(statuses).toContain("sent");
}, COLD_BOOT_BUDGET_MS);

test("an expired dispatch lease is picked up by the tick, and a live one is left in flight", async () => {
  const db = await openDb({ stub: true });
  const org = await seedOrg(db, "expired-lease");
  await connectSlackChannel(db, org, CHANNEL);

  const stale = await seedNotification(db, {
    organizationId: org.organizationId,
    subjectId: randomUUID(),
  });
  const fresh = await seedNotification(db, {
    organizationId: org.organizationId,
    subjectId: randomUUID(),
  });

  // A claim older than the TTL is a crashed process; one claimed just now is a runner
  // mid-post, and re-dispatching it would race the lease it holds.
  await db.insert(schema.notificationSends).values({
    organizationId: org.organizationId,
    notificationId: stale.id,
    channel: "slack",
    target: CHANNEL,
    status: "pending",
    attempts: 1,
    claimedAt: new Date(Date.now() - 6 * 60 * 1_000),
  });
  await db.insert(schema.notificationSends).values({
    organizationId: org.organizationId,
    notificationId: fresh.id,
    channel: "slack",
    target: CHANNEL,
    status: "pending",
    attempts: 1,
    claimedAt: new Date(),
  });

  await runTick(db);
  await drainRescueJobs(db);

  const dispatched = dispatchJobsOf(await capturedJobs(db))
    .map(dispatchPayloadOf)
    .map((payload) => payload.notificationId);
  expect(dispatched).toContain(stale.id);
  expect(dispatched).not.toContain(fresh.id);

  const recorder = loudPoster();
  await runAllDispatchJobs(db, recorder.poster);

  expect((await sendRowsFor(db, stale.id)).map((row) => row.status)).toContain("sent");
  expect((await sendRowsFor(db, fresh.id)).map((row) => row.status)).toEqual(["pending"]);
}, COLD_BOOT_BUDGET_MS);

test("the sweep's cadence in the crontab is the rescue-tick constant, not a look-alike number", () => {
  const line = crontab
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.split(/\s+/)[5] === TASK.NOTIFICATION_RESCUE_TICK);

  expect(line).toBeDefined();

  const minutes = /^\*\/(\d+)$/.exec((line ?? "").split(/\s+/)[0] ?? "");
  expect(minutes).not.toBeNull();

  // The sweep's period IS the unattended-work horizon the claim TTL declares. Nothing but
  // this binds the constant to what actually runs, and an expired lease must not wait on
  // a cadence unrelated to the horizon that declared it expired (a39b599's drift shape).
  expect(Number(minutes?.[1]) * 60 * 1_000).toBe(NOTIFICATION_RESCUE_TICK_INTERVAL_MS);
});
