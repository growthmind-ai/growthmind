// D11 wire for O-053 ADD Decision 1: the readout is a notifications row with an `owed` Slack
// leg, never `quiet_digest` — so it is delivered once and can never come back a week later
// inside the weekly summary. RED in Wave 0: the service and the type are absent.
import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { SHIPPED_UNMEASURED_OUTCOMES, buildChangeReadoutDedupKey } from "@growthmind/shared";

import { notifications, notificationSends } from "../../src/schema/notifications";
import { shippedChanges } from "../../src/schema/shipped-changes";
import { gatherDigestNotifications } from "../../src/services/notification-digest.service";
import { createShippedChangesService } from "../../src/services/shipped-changes.service";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedNotification,
  seedNotificationSend,
  seedOrgWithOwner,
  seedProject,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type SeededProject,
  type TestDb,
  type TestDbHandle,
} from "../../src/testing";
import { connectSlackChannel, dispatchJobsOf, dispatchPayloadOf } from "../helpers/o051-contracts";

const NAMES = laneNames("wire-change-readout");

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const READ_OUT_AT = new Date("2026-08-23T09:00:00.000Z");
const READ_OUT_AGAIN_AT = new Date("2026-08-23T10:00:00.000Z");
const REPORTED_AGAIN_AT = new Date("2026-08-23T09:30:00.000Z");

const DAY_MS = 24 * 60 * 60 * 1_000;

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

async function seedTenant(
  db: TestDb,
  label: string,
): Promise<{ org: SeededOrgWithOwner; project: SeededProject }> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });

  return { org, project };
}

async function reportChange(db: TestDb, org: SeededOrgWithOwner, project: SeededProject) {
  return (
    await createShippedChangesService(db, org.ctx).reportShipped({
      projectId: project.id,
      page: "/reports",
      control: "Export CSV",
      description: "CSV export",
      reportedAt: REPORTED_AT,
    })
  ).change;
}

async function changeRow(db: TestDb, changeId: string) {
  const rows = await db.select().from(shippedChanges).where(eq(shippedChanges.id, changeId));

  return rows[0];
}

async function readoutRowsFor(db: TestDb, organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.type, "change_readout"),
      ),
    );
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

describe("a readout is told to the whole organization, once", () => {
  test("one readout emits one org-audience notification with an owed Slack leg", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "emitted");
    await connectSlackChannel(db, org, "C0READOUT01");

    const change = await reportChange(db, org, project);
    await createShippedChangesService(db, org.ctx).recordReadout({
      changeId: change.id,
      readOutAt: READ_OUT_AT,
    });

    const rows = await readoutRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    if (!row) throw new Error("the readout emitted no change_readout notification");

    expect(row.audience).toBe("org");
    expect(row.subjectKind).toBe("shipped_change");
    expect(row.subjectId).toBe(change.id);
    expect(row.dedupKey).toBe(buildChangeReadoutDedupKey(change.id, change.readoutDueAt));

    // Owed, not deferred: the one registered dispatch seam carries it, this hour.
    const forThisRow = dispatchJobsOf(await capturedJobs(db)).filter(
      (job) => dispatchPayloadOf(job).notificationId === row.id,
    );
    expect(forThisRow).toHaveLength(1);
  });

  test("a second readout of the same change writes no second notification", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "redelivery");
    await connectSlackChannel(db, org, "C0READOUT02");
    const service = createShippedChangesService(db, org.ctx);

    const change = await reportChange(db, org, project);
    await service.recordReadout({ changeId: change.id, readOutAt: READ_OUT_AT });

    // The control beside the count below: the first readout really did emit, so the
    // unchanged count after the second is D4 and not an emitter that never fired.
    expect(await readoutRowsFor(db, org.organizationId)).toHaveLength(1);

    await service.recordReadout({ changeId: change.id, readOutAt: READ_OUT_AGAIN_AT });

    const rows = await readoutRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupKey).toBe(buildChangeReadoutDedupKey(change.id, change.readoutDueAt));
  });
});

describe("a change we could not measure is answered again once it is re-reported", () => {
  test("the reopened row is read out a second time, and the second answer reaches the channel", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "reopened");
    await connectSlackChannel(db, org, "C0READOUT03");
    const service = createShippedChangesService(db, org.ctx);

    const change = await reportChange(db, org, project);
    await service.recordReadout({ changeId: change.id, readOutAt: READ_OUT_AT });

    // Nothing was ever recorded against this page, so the readout could not measure anything —
    // which is the branch R12 refuses to let close the change.
    const readOut = await changeRow(db, change.id);
    const outcomes: readonly string[] = SHIPPED_UNMEASURED_OUTCOMES;
    expect(outcomes).toContain(readOut?.readoutOutcome ?? "measured");
    expect(await readoutRowsFor(db, org.organizationId)).toHaveLength(1);

    const again = await service.reportShipped({
      projectId: project.id,
      page: "/reports",
      control: "Export CSV",
      description: "CSV export, second pass",
      reportedAt: REPORTED_AGAIN_AT,
    });

    expect(again.claim).toBe("watching_again");
    expect(again.change.id).toBe(change.id);

    await service.recordReadout({ changeId: change.id, readOutAt: READ_OUT_AGAIN_AT });

    // Two answers, because the row answered two different clocks. A dedup key that knew only
    // the change id would have swallowed the second one and left the reopen unanswerable.
    const rows = await readoutRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.dedupKey)).size).toBe(2);
    expect(rows.map((row) => row.dedupKey)).toContain(
      buildChangeReadoutDedupKey(change.id, again.change.readoutDueAt),
    );
  });
});

describe("an owed readout never comes back inside the weekly summary", () => {
  test("the weekly gather returns the deferred record and not the readout", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "digest");

    // No Slack channel, so the readout's own receipt is quiet — the sharpest near-miss for a
    // sweep that selects on quiet, because only `digest` is the reason it may take.
    const change = await reportChange(db, org, project);
    await createShippedChangesService(db, org.ctx).recordReadout({
      changeId: change.id,
      readOutAt: READ_OUT_AT,
    });

    const readouts = await readoutRowsFor(db, org.organizationId);
    expect(readouts).toHaveLength(1);
    const readout = readouts[0];
    if (!readout) throw new Error("the readout emitted no change_readout notification");
    expect(
      (await sendRowsFor(db, readout.id)).map((send) => [send.status, send.quietReason]),
    ).toEqual([["quiet", "no_channel"]]);

    // The non-vacuity control: a genuinely deferred record in the same window and the same
    // org, so an empty gather cannot pass this test.
    const deferred = await seedNotification(db, {
      organizationId: org.organizationId,
      type: "backfill_complete",
      subjectKind: "source_connection",
    });
    await seedNotificationSend(db, {
      organizationId: org.organizationId,
      notificationId: deferred.id,
      status: "quiet",
      quietReason: "digest",
      target: "none",
    });

    const gathered = await gatherDigestNotifications(db, org.ctx, {
      windowStart: new Date(Date.now() - DAY_MS),
      windowEnd: new Date(Date.now() + DAY_MS),
      limit: 20,
    });

    expect(gathered.notificationIds).toEqual([deferred.id]);
    expect(gathered.notificationIds).not.toContain(readout.id);
    expect(gathered.totalCount).toBe(1);
  });
});
