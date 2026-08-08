// D11 wire for ADD §4.2: the drained-cursor fact is computed by applyCursors and emitted
// by runOnePass — so the drive is the REAL poll path, never the applier alone. One
// connection is walked through both arms: the not-contiguous hold emits nothing, and the
// drain that follows emits exactly once, with a quiet/digest receipt even though a live
// Slack channel exists. RED in Wave 0: the poll emits nothing yet.
//
// Fresh database per test: the poll claims every due connection it can see.
import { afterAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { NOTIFICATION_CLASS_BY_TYPE } from "@growthmind/shared";

import { notifications, notificationSends } from "../../src/schema/notifications";
import { projectConnections } from "../../src/schema/project-connections";
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
  loadSessionSourcePoll,
  loadWirePollFixtures,
} from "../helpers/o051-contracts";

const NAMES = laneNames("wire-backfill-complete");

const NOW = new Date("2026-08-06T18:00:00.000Z");

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

async function backfillCompleteRows(db: TestDb, organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.type, "backfill_complete"),
      ),
    );
}

async function backfillCursorOf(db: TestDb, connectionId: string): Promise<string | null> {
  const [row] = await db
    .select({ backfillBefore: projectConnections.backfillBefore })
    .from(projectConnections)
    .where(eq(projectConnections.id, connectionId));
  return row?.backfillBefore ?? null;
}

test("the held cursor emits nothing, and the drain that follows emits exactly one record-class notification with a quiet digest receipt", async () => {
  const db = await openDb();
  const org = await seedOrg(db, "hold-then-drain");
  await connectSlackChannel(db, org, "C0BACKFILL1");

  const fixtures = await loadWirePollFixtures();
  const runPoll = await loadSessionSourcePoll();
  const env = fixtures.testServerEnv();
  const sourceProjectId = "o051-wire-src";

  // Never polled: no watermark, no cursor — the first walk is all backfill.
  const seeded = await fixtures.seedProjectWithConnection(db, {
    prefix: "o051-",
    now: NOW,
    organizationId: org.organizationId,
    sourceProjectId,
    watermarkAt: null,
    backfillBefore: null,
    credentialFor: (ids) => fixtures.encryptTestCredential({ env, ...ids }),
  });

  // Phase 1 source: an endless backlog, one older event and a next cursor per page, so
  // the walk stops on the page cap with contiguous:false — the hold arm. Phase 2 source:
  // nothing left, so the walk exhausts and the stale cursor is cleared — the drain.
  let backlogOpen = true;
  const posthog = fixtures.createFakePostHog({
    events: (request) => {
      if (!backlogOpen) return { results: [], next: null };
      const idx = request.callIndex;
      return {
        results: [
          fixtures.fakeEvent({
            id: `o051-evt-${String(idx)}`,
            distinctId: `o051-visitor-${String(idx)}`,
            sessionId: `o051-session-${String(idx)}`,
            occurredAt: new Date(NOW.getTime() - (idx + 1) * 60_000),
            pathname: "/",
          }),
        ],
        next: fixtures.nextCursorUrl({
          sourceProjectId,
          before: new Date(NOW.getTime() - (idx + 2) * 60_000),
        }),
      };
    },
  });
  const clock = fixtures.createFakeClock(NOW);

  await runPoll(fixtures.createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The pairing that keeps the zero below honest: the cursor is genuinely held, so this
  // pass took the not-contiguous branch rather than doing nothing.
  expect(await backfillCursorOf(db, seeded.connectionId)).not.toBeNull();
  expect(await backfillCompleteRows(db, org.organizationId)).toHaveLength(0);

  // Phase 2: the backlog is exhausted, the next due tick drains and clears the cursor —
  // ADD §4.2's emit gate, on the same connection the hold left behind.
  backlogOpen = false;
  clock.advance(120_000);
  await runPoll(fixtures.createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(await backfillCursorOf(db, seeded.connectionId)).toBeNull();

  const rows = await backfillCompleteRows(db, org.organizationId);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("the drained pass emitted no backfill_complete notification");

  expect(row.subjectKind).toBe("source_connection");
  expect(row.subjectId).toBe(seeded.connectionId);
  expect(NOTIFICATION_CLASS_BY_TYPE.backfill_complete).toBe("record");

  const sends = await db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, row.id));
  expect(sends.map((send) => [send.status, send.quietReason])).toEqual([["quiet", "digest"]]);

  // Deferred to the summary means no dispatch job either — the channel exists and is
  // deliberately not used (ADD D-7).
  expect(dispatchJobsOf(await capturedJobs(db))).toHaveLength(0);
});
