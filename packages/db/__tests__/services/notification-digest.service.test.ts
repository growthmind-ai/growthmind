// The ADD's Wave-0 row for D-8: a second digest never repeats what the first one carried.
// Window boundaries are due-day date arithmetic in DIGEST_EVALUATION_TIME_ZONE, so the
// windows tile — exclusive start on the previous boundary, inclusive end on this one —
// whichever day the org picks and however many hourly runs see the day.
import { randomUUID } from "node:crypto";

import { NOTIFICATION_SEND_NO_TARGET, parseNotificationPayload } from "@growthmind/shared";
import type { DigestCadence, Weekday } from "@growthmind/shared";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { notificationSettings } from "../../src/schema/notification-settings";
import { notifications } from "../../src/schema/notifications";
import { gatherDigestNotifications } from "../../src/services/notification-digest.service";
import {
  createTestDb,
  laneNames,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";
import {
  connectSlackChannel,
  loadDigest,
  setNotificationCreatedAt,
  silentLogger,
} from "../helpers/o051-contracts";

const NAMES = laneNames("o051-digest-service");

const CHANNEL = "C0DIGESTSVC";

const COLD_BOOT_BUDGET_MS = 60_000;

// 2026-09-07 is a Monday; the run instants sit mid-morning inside their due day, the way
// an hourly cron lands, and every fixture instant is fixed so the suite cannot drift with
// the wall clock.
const WEEK_START = new Date("2026-08-31T00:00:00.000Z");
const MONDAY_BOUNDARY = new Date("2026-09-07T00:00:00.000Z");
const MONDAY_RUN = new Date("2026-09-07T09:30:00.000Z");
const MONDAY_LATER_RUN = new Date("2026-09-07T11:30:00.000Z");
const MONDAY_MIDDAY_ROW = new Date("2026-09-07T10:00:00.000Z");
const SUMMARY_INSERTED_AT = new Date("2026-09-07T09:30:05.000Z");
const WEEK_ONE_ROW = new Date("2026-09-05T12:00:00.000Z");
const TUESDAY_ROW = new Date("2026-09-08T12:00:00.000Z");
const WEDNESDAY_ROW = new Date("2026-09-09T12:00:00.000Z");
const THURSDAY_RUN = new Date("2026-09-10T09:30:00.000Z");
const NEXT_MONDAY_RUN = new Date("2026-09-14T09:30:00.000Z");

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await stubGraphileAddJob(db);
});

afterAll(async () => {
  await close();
});

let orgCount = 0;

async function seedOrg(label: string): Promise<SeededOrgWithOwner> {
  orgCount += 1;
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(`${label}-${String(orgCount)}`),
    userName: NAMES.userName(label),
    email: NAMES.email(`${label}-${String(orgCount)}`),
  });
  await connectSlackChannel(db, org, CHANNEL);
  return org;
}

async function setSettings(
  organizationId: string,
  cadence: DigestCadence,
  day: Weekday,
): Promise<void> {
  await db
    .insert(notificationSettings)
    .values({ organizationId, digestCadence: cadence, digestDay: day });
}

async function moveDigestDay(organizationId: string, day: Weekday): Promise<void> {
  await db
    .update(notificationSettings)
    .set({ digestDay: day })
    .where(eq(notificationSettings.organizationId, organizationId));
}

async function seedQuietDigestRow(org: SeededOrgWithOwner, createdAt: Date): Promise<string> {
  const seeded = await seedNotification(db, {
    organizationId: org.organizationId,
    type: "backfill_complete",
    subjectKind: "source_connection",
    subjectId: randomUUID(),
    payload: { type: "backfill_complete", v: 1, sessionsTouched: 3, eventsPersisted: 12 },
    createdAt,
  });
  await seedNotificationSend(db, {
    organizationId: org.organizationId,
    notificationId: seeded.id,
    status: "quiet",
    quietReason: "digest",
    target: NOTIFICATION_SEND_NO_TARGET,
  });
  return seeded.id;
}

async function runDigest(at: Date): Promise<void> {
  const digest = await loadDigest();
  await digest({ db, now: () => new Date(at.getTime()), logger: silentLogger });
}

async function digestRows(organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), eq(notifications.type, "digest")));
}

function payloadIdsOf(row: { payload: unknown } | undefined): readonly string[] {
  const parsed = parseNotificationPayload(row?.payload);
  if (!parsed.ok || parsed.payload.type !== "digest") {
    throw new Error("the summary's payload is not the digest arm");
  }
  return parsed.payload.notificationIds;
}

async function seedRowWithReceipt(
  org: SeededOrgWithOwner,
  createdAt: Date,
  receipt: {
    readonly status: "sent" | "failed" | "quiet";
    readonly quietReason?: string;
    readonly failureReason?: string;
  },
): Promise<string> {
  const seeded = await seedNotification(db, {
    organizationId: org.organizationId,
    type: "backfill_complete",
    subjectKind: "source_connection",
    subjectId: randomUUID(),
    payload: { type: "backfill_complete", v: 1, sessionsTouched: 3, eventsPersisted: 12 },
    createdAt,
  });
  await seedNotificationSend(db, {
    organizationId: org.organizationId,
    notificationId: seeded.id,
    status: receipt.status,
    quietReason: receipt.quietReason ?? null,
    failureReason: receipt.failureReason ?? null,
    target: receipt.status === "quiet" ? NOTIFICATION_SEND_NO_TARGET : CHANNEL,
  });
  return seeded.id;
}

// CR-4: the status filter is what stands between the summary and P-1's same-thing-twice
// deal-breaker — a window-only gather would re-summarise notifications Slack already
// posted, and count rows the summary never carries.
test(
  "the gather takes only quiet-digest receipts, and totalCount counts only them",
  async () => {
    const org = await seedOrg("gather-status");

    const deferredOne = await seedQuietDigestRow(org, WEEK_ONE_ROW);
    const deferredTwo = await seedQuietDigestRow(org, MONDAY_BOUNDARY);

    // Same window, wrong population: posted, failed, silenced-for-no-channel, unsettled.
    await seedRowWithReceipt(org, WEEK_ONE_ROW, { status: "sent" });
    await seedRowWithReceipt(org, WEEK_ONE_ROW, { status: "failed", failureReason: "call_failed" });
    await seedRowWithReceipt(org, WEEK_ONE_ROW, { status: "quiet", quietReason: "no_channel" });
    await seedNotification(db, {
      organizationId: org.organizationId,
      type: "backfill_complete",
      subjectKind: "source_connection",
      subjectId: randomUUID(),
      payload: { type: "backfill_complete", v: 1, sessionsTouched: 1, eventsPersisted: 4 },
      createdAt: WEEK_ONE_ROW,
    });

    // Another org's deferred row in the same window is not this org's summary (D7).
    const other = await seedOrg("gather-status-other");
    await seedQuietDigestRow(other, WEEK_ONE_ROW);

    const window = { windowStart: WEEK_START, windowEnd: MONDAY_BOUNDARY };

    const gathered = await gatherDigestNotifications(db, org.ctx, { ...window, limit: 10 });
    expect([...gathered.notificationIds].toSorted()).toEqual([deferredOne, deferredTwo].toSorted());
    expect(gathered.totalCount).toBe(2);

    // The denominator describes the window's deferred population, never the capped list.
    const capped = await gatherDigestNotifications(db, org.ctx, { ...window, limit: 1 });
    expect(capped.notificationIds).toHaveLength(1);
    expect(capped.totalCount).toBe(2);
  },
  COLD_BOOT_BUDGET_MS,
);

test(
  "a second digest never repeats what the first one carried, and the boundary row rides exactly once",
  async () => {
    const org = await seedOrg("no-repeat");
    await setSettings(org.organizationId, "weekly", "monday");

    const boundaryRow = await seedQuietDigestRow(org, MONDAY_BOUNDARY);
    const weekOne = await seedQuietDigestRow(org, WEEK_ONE_ROW);

    await runDigest(MONDAY_RUN);
    const [first] = await digestRows(org.organizationId);
    if (!first) {
      throw new Error("the first run emitted no summary");
    }
    expect([...payloadIdsOf(first)].toSorted()).toEqual([boundaryRow, weekOne].toSorted());

    await setNotificationCreatedAt(db, first.id, SUMMARY_INSERTED_AT);

    const weekTwo = await seedQuietDigestRow(org, WEDNESDAY_ROW);

    await runDigest(NEXT_MONDAY_RUN);

    const summaries = await digestRows(org.organizationId);
    expect(summaries).toHaveLength(2);

    const second = summaries.find((row) => row.id !== first.id);
    expect([...payloadIdsOf(second)]).toEqual([weekTwo]);
  },
  COLD_BOOT_BUDGET_MS,
);

test(
  "an org that moves its digest day mid-week does not double-report the overlap",
  async () => {
    const org = await seedOrg("day-change");
    await setSettings(org.organizationId, "weekly", "monday");

    const weekOne = await seedQuietDigestRow(org, WEEK_ONE_ROW);

    await runDigest(MONDAY_RUN);
    const [first] = await digestRows(org.organizationId);
    if (!first) {
      throw new Error("the first run emitted no summary");
    }
    expect([...payloadIdsOf(first)]).toEqual([weekOne]);

    await setNotificationCreatedAt(db, first.id, SUMMARY_INSERTED_AT);

    await moveDigestDay(org.organizationId, "thursday");
    const betweenDays = await seedQuietDigestRow(org, TUESDAY_ROW);

    await runDigest(THURSDAY_RUN);

    const summaries = await digestRows(org.organizationId);
    expect(summaries).toHaveLength(2);

    const second = summaries.find((row) => row.id !== first.id);
    expect([...payloadIdsOf(second)]).toEqual([betweenDays]);
  },
  COLD_BOOT_BUDGET_MS,
);

test(
  "a later run of the same due day cannot re-summarise it",
  async () => {
    const org = await seedOrg("same-day");
    await setSettings(org.organizationId, "weekly", "monday");

    await seedQuietDigestRow(org, WEEK_ONE_ROW);

    await runDigest(MONDAY_RUN);
    const [first] = await digestRows(org.organizationId);
    if (!first) {
      throw new Error("the first run emitted no summary");
    }
    await setNotificationCreatedAt(db, first.id, SUMMARY_INSERTED_AT);

    // Lands between the day's hourly runs; the later run must leave it to next week rather
    // than mint a second summary for the same Monday.
    await seedQuietDigestRow(org, MONDAY_MIDDAY_ROW);

    await runDigest(MONDAY_LATER_RUN);

    expect(await digestRows(org.organizationId)).toHaveLength(1);
  },
  COLD_BOOT_BUDGET_MS,
);
