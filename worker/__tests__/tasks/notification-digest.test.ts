// notification:digest (ADD D-8): gathers the week's quiet-digest receipts per due org and
// emits ONE summary through the ordinary owed arm — it posts nothing itself. The due-day
// enumeration LEFT JOINs notification_settings because absence is the default, and an
// empty week emits no row at all, not a row saying nothing happened. RED in Wave 0: the
// task is a throwing stub.
import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";

import { NOTIFICATION_DIGEST_TICK_INTERVAL_MS } from "@growthmind/core";
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
  NOTIFICATION_SEND_NO_TARGET,
  parseNotificationPayload,
  type DigestCadence,
  type Weekday,
} from "@growthmind/shared";

import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  loadDigest,
  loudPoster,
  runAllDispatchJobs,
  silentLogger,
} from "../../../packages/db/__tests__/helpers/o051-contracts";
import { crontab } from "../../src/index";
import { TASK } from "../../src/task-names";

const NAMES = laneNames("o051-digest-task");

const CHANNEL = "C0DIGEST01";

const COLD_BOOT_BUDGET_MS = 60_000;

const HOUR_MS = 60 * 60 * 1_000;

// The evaluation instant is a real future Monday in UTC, derived from the wall clock
// rather than pinned: the gather's window ends at the task's `now`, and fodder seeded in
// the recent past must stay inside it whenever this suite runs.
function nextUtcMonday(from: Date): Date {
  const at = new Date(from.getTime());
  do {
    at.setTime(at.getTime() + 24 * HOUR_MS);
  } while (at.getUTCDay() !== 1);
  at.setUTCHours(9, 30, 0, 0);
  return at;
}

const MONDAY = nextUtcMonday(new Date());

// Two hours back: inside the 30-day window before MONDAY, and before any digest row this
// suite's own runs create, so a second run's since-last-summary window excludes it.
const FODDER_AT = new Date(Date.now() - 2 * HOUR_MS);

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

async function setSettings(
  db: TestDb,
  organizationId: string,
  cadence: DigestCadence,
  day: Weekday,
): Promise<void> {
  await db
    .insert(schema.notificationSettings)
    .values({ organizationId, digestCadence: cadence, digestDay: day });
}

// A record-class notification whose Slack receipt says "in the summary" — exactly the
// population `quiet: digest` was minted for (D-7's first implication).
async function seedDigestFodder(
  db: TestDb,
  org: SeededOrgWithOwner,
  count: number,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const seeded = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "backfill_complete",
      subjectKind: "source_connection",
      subjectId: randomUUID(),
      payload: { type: "backfill_complete", v: 1, sessionsTouched: 3 + index, eventsPersisted: 40 + index },
      createdAt: FODDER_AT,
    });
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: seeded.id,
      status: "quiet",
      quietReason: "digest",
      target: NOTIFICATION_SEND_NO_TARGET,
    });
    ids.push(seeded.id);
  }
  return ids;
}

async function runDigest(db: TestDb, at: Date): Promise<void> {
  const digest = await loadDigest();
  await digest({ db, now: () => new Date(at.getTime()), logger: silentLogger });
}

async function digestRowsFor(db: TestDb, organizationId: string) {
  const rows = await db.select().from(schema.notifications);
  return rows.filter((row) => row.organizationId === organizationId && row.type === "digest");
}

async function notificationRowsFor(db: TestDb, organizationId: string) {
  const rows = await db.select().from(schema.notifications);
  return rows.filter((row) => row.organizationId === organizationId);
}

async function sendRowsForOrg(db: TestDb, organizationId: string) {
  const rows = await db.select().from(schema.notificationSends);
  return rows.filter((row) => row.organizationId === organizationId);
}

test("one summary for the due org, and nothing for another day, cadence off, or no Slack", async () => {
  const db = await openDb();

  const due = await seedOrg(db, "due");
  await connectSlackChannel(db, due, CHANNEL);
  await setSettings(db, due.organizationId, "weekly", "monday");
  const fodder = await seedDigestFodder(db, due, 2);

  const otherDay = await seedOrg(db, "other-day");
  await connectSlackChannel(db, otherDay, CHANNEL);
  await setSettings(db, otherDay.organizationId, "weekly", "tuesday");
  await seedDigestFodder(db, otherDay, 1);

  const off = await seedOrg(db, "off");
  await connectSlackChannel(db, off, CHANNEL);
  await setSettings(db, off.organizationId, "off", "monday");
  await seedDigestFodder(db, off, 1);

  const noSlack = await seedOrg(db, "no-slack");
  await setSettings(db, noSlack.organizationId, "weekly", "monday");
  await seedDigestFodder(db, noSlack, 1);

  await runDigest(db, MONDAY);

  const summaries = await digestRowsFor(db, due.organizationId);
  expect(summaries).toHaveLength(1);

  // The payload freezes ids and the window's own total, never text (D-8).
  const parsed = parseNotificationPayload(summaries[0]?.payload);
  if (!parsed.ok || parsed.payload.type !== "digest") {
    throw new Error("the summary's payload is not the digest arm");
  }
  expect([...parsed.payload.notificationIds].toSorted()).toEqual([...fodder].toSorted());
  expect(parsed.payload.totalCount).toBe(fodder.length);

  // The Slack leg is the ordinary owed arm: one queued dispatch job, no direct post.
  const dispatchJobs = dispatchJobsOf(await capturedJobs(db)).map(dispatchPayloadOf);
  expect(
    dispatchJobs.filter((payload) => payload.notificationId === summaries[0]?.id),
  ).toHaveLength(1);

  expect(await digestRowsFor(db, otherDay.organizationId)).toEqual([]);
  expect(await digestRowsFor(db, off.organizationId)).toEqual([]);
  expect(await digestRowsFor(db, noSlack.organizationId)).toEqual([]);
}, COLD_BOOT_BUDGET_MS);

test("an org that never opened the settings card still gets its default Monday summary", async () => {
  const db = await openDb();

  // No notification_settings row AT ALL — absence is the default (D-6), and the due-org
  // enumeration must LEFT JOIN to see this org. Seeding a row set to Monday would pass
  // against an INNER JOIN and prove nothing.
  const org = await seedOrg(db, "never-opened");
  await connectSlackChannel(db, org, CHANNEL);
  await seedDigestFodder(db, org, 2);

  const settingsRows = (await db.select().from(schema.notificationSettings)).filter(
    (row) => row.organizationId === org.organizationId,
  );
  expect(settingsRows).toEqual([]);

  await runDigest(db, MONDAY);

  expect(await digestRowsFor(db, org.organizationId)).toHaveLength(1);
}, COLD_BOOT_BUDGET_MS);

test("an empty week emits nothing at all — zero notification rows, zero receipts, zero jobs", async () => {
  const db = await openDb();

  const org = await seedOrg(db, "empty-week");
  await connectSlackChannel(db, org, CHANNEL);
  await setSettings(db, org.organizationId, "weekly", "monday");

  await runDigest(db, MONDAY);

  // Zero rows, not zero posts: "posts nothing" would still leave a contentless summary
  // sitting in the bell every week, which is a different lie (ADD §9).
  expect(await notificationRowsFor(db, org.organizationId)).toEqual([]);
  expect(await sendRowsForOrg(db, org.organizationId)).toEqual([]);
  expect(
    dispatchJobsOf(await capturedJobs(db))
      .map(dispatchPayloadOf)
      .filter((payload) => payload.organizationId === org.organizationId),
  ).toEqual([]);
}, COLD_BOOT_BUDGET_MS);

test("twenty-four runs of a due day produce one summary, one receipt and one post", async () => {
  const db = await openDb();

  const org = await seedOrg(db, "hourly");
  await connectSlackChannel(db, org, CHANNEL);
  await setSettings(db, org.organizationId, "weekly", "monday");
  await seedDigestFodder(db, org, 3);

  // The once-per-week guarantee must rest on the dedup conflict and the window, never on
  // the cron line happening to fire once (ADD §9's third digest hazard).
  const midnightHalfPast = new Date(MONDAY.getTime());
  midnightHalfPast.setUTCHours(0, 30, 0, 0);
  for (let hour = 0; hour < 24; hour += 1) {
    await runDigest(db, new Date(midnightHalfPast.getTime() + hour * HOUR_MS));
  }

  const summaries = await digestRowsFor(db, org.organizationId);
  expect(summaries).toHaveLength(1);

  const recorder = loudPoster();
  await runAllDispatchJobs(db, recorder.poster);
  expect(recorder.posted).toHaveLength(1);

  const receipts = (await sendRowsForOrg(db, org.organizationId)).filter(
    (row) => row.notificationId === summaries[0]?.id,
  );
  expect(receipts).toHaveLength(1);
  expect(receipts[0]?.status).toBe("sent");
}, COLD_BOOT_BUDGET_MS);

test("the digest's cadence in the crontab is the digest-tick constant: hourly, on every day", () => {
  const line = crontab
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.split(/\s+/)[5] === TASK.NOTIFICATION_DIGEST);

  expect(line).toBeDefined();

  const fields = (line ?? "").split(/\s+/);

  // A fixed minute with a wildcard hour is one run per hour — the coarsest cadence that
  // can still resolve a day, on every day, because orgs pick different days (a39b599's
  // drift shape: the constant a reader derives behaviour from must be what actually runs).
  expect(/^\d+$/.test(fields[0] ?? "")).toBe(true);
  expect(fields[1]).toBe("*");
  expect(HOUR_MS).toBe(NOTIFICATION_DIGEST_TICK_INTERVAL_MS);
});
