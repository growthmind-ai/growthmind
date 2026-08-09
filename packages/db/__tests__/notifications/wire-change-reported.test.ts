// D11 wire for O-053 ADD Decision 1: the acknowledgement rides the notification spine, so
// the drive is the service the MCP write port calls and never a bespoke Slack poster. RED
// in Wave 0: the service, the type and the subject kind are all absent.
//
// Contract pinned here for Wave 4: createShippedChangesService(db, ctx).reportShipped takes
// no readout date — the product sets it — and returns the change row.
import { afterAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { buildChangeReportedDedupKey } from "@growthmind/shared";

import { notifications, notificationSends } from "../../src/schema/notifications";
import { shippedChanges } from "../../src/schema/shipped-changes";
import { createShippedChangesService } from "../../src/services/shipped-changes.service";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type SeededProject,
  type TestDb,
  type TestDbHandle,
} from "../../src/testing";
import { connectSlackChannel, dispatchJobsOf, dispatchPayloadOf } from "../helpers/o051-contracts";

const NAMES = laneNames("wire-change-reported");

const REPORTED_AT = new Date("2026-08-09T09:00:00.000Z");
const REPORTED_AGAIN_AT = new Date("2026-08-12T15:30:00.000Z");

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

function reportInput(
  projectId: string,
  overrides: { description?: string; reportedAt?: Date } = {},
) {
  return {
    projectId,
    page: "/reports",
    control: "Export CSV",
    description: overrides.description ?? "CSV export",
    reportedAt: overrides.reportedAt ?? REPORTED_AT,
  };
}

// The full org scope, never a limit-1 helper: a second acknowledgement hides behind a "most
// recent" lookup and the D4 claim then reports success on a duplicated row.
async function reportedRowsFor(db: TestDb, organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.type, "change_reported"),
      ),
    );
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

async function changeRowsFor(db: TestDb, projectId: string) {
  return db.select().from(shippedChanges).where(eq(shippedChanges.projectId, projectId));
}

describe("an accepted report tells the whole organization, through the spine", () => {
  test("one report emits one org-audience notification against the change, with an owed Slack leg", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "accepted");
    await connectSlackChannel(db, org, "C0SHIPPED01");

    const { change } = await createShippedChangesService(db, org.ctx).reportShipped(
      reportInput(project.id),
    );

    const rows = await reportedRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    if (!row) throw new Error("the accepted report emitted no change_reported notification");

    // D1: the audience the findings already use, never the key that reported it.
    expect(row.audience).toBe("org");
    expect(row.subjectKind).toBe("shipped_change");
    expect(row.subjectId).toBe(change.id);
    expect(row.actorUserId).toBeNull();
    expect(row.dedupKey).toBe(buildChangeReportedDedupKey(change.id));

    // The owed arm resolves the org's channel inside the caller's transaction and queues the
    // one registered dispatch seam — this sprint adds no Slack call site of its own.
    const dispatches = dispatchJobsOf(await capturedJobs(db));
    expect(dispatches).toHaveLength(1);
    const queued = dispatches[0];
    if (!queued) throw new Error("the owed leg queued no dispatch job");
    expect(dispatchPayloadOf(queued).notificationId).toBe(row.id);
  });

  test("a re-report updates the change in place and promises no second date", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "re-report");
    await connectSlackChannel(db, org, "C0SHIPPED02");
    const service = createShippedChangesService(db, org.ctx);

    const first = await service.reportShipped(reportInput(project.id));
    expect(first.claim).toBe("reported");

    // The control beside the counts below: one report really did produce one acknowledgement,
    // so a second report producing none is dedup rather than an emitter that never fires.
    expect(await reportedRowsFor(db, org.organizationId)).toHaveLength(1);

    const again = await service.reportShipped(
      reportInput(project.id, {
        description: "CSV export, now with column headings",
        reportedAt: REPORTED_AGAIN_AT,
      }),
    );

    expect(again.claim).toBe("clock_unchanged");
    expect(again.change.id).toBe(first.change.id);
    expect(await changeRowsFor(db, project.id)).toHaveLength(1);

    // FR-5.5: the dedup key is the change id, so the second report cannot mint an
    // acknowledgement carrying a second readout date.
    const rows = await reportedRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupKey).toBe(buildChangeReportedDedupKey(first.change.id));
  });

  test("an identical report redelivered leaves one notification and one receipt", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "redelivery");
    const service = createShippedChangesService(db, org.ctx);

    await service.reportShipped(reportInput(project.id));
    await service.reportShipped(reportInput(project.id));

    const rows = await reportedRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    if (!row) throw new Error("the redelivered report emitted no change_reported notification");
    expect(await sendRowsFor(db, row.id)).toHaveLength(1);
  });
});

describe("a workspace with no Slack channel still gets the fact, and the receipt says so", () => {
  test("the report succeeds, the receipt is quiet with no channel, and nothing throws", async () => {
    const db = await openDb();
    const { org, project } = await seedTenant(db, "no-channel");

    const { change } = await createShippedChangesService(db, org.ctx).reportShipped(
      reportInput(project.id),
    );

    expect(await changeRowsFor(db, project.id)).toHaveLength(1);

    const rows = await reportedRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("the report with no channel emitted no notification");
    expect(row.subjectId).toBe(change.id);

    // FR-11.2: silence gets a receipt with a stated reason, and no dispatch job is queued
    // against a channel that does not exist.
    expect((await sendRowsFor(db, row.id)).map((send) => [send.status, send.quietReason])).toEqual([
      ["quiet", "no_channel"],
    ]);
    expect(dispatchJobsOf(await capturedJobs(db))).toHaveLength(0);
  });
});
