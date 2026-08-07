// The class invariant, rewritten total (ADD D-7, AC-17/AC-24): every notification type
// carries a Slack receipt, proven by a drive table `satisfies Record<NotificationType,
// Drive>` — an unmapped type is a typecheck failure, never a silently uncovered one. Each
// drive is the REAL emitter seam for its type. Per-test databases: the drives claim
// connections and queue jobs, and must not see each other.
import { randomUUID } from "node:crypto";

import { afterAll, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import {
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_TYPES,
  RENDERED_MESSAGE_VERSION,
  type NotificationType,
  type RenderedMessage,
} from "@growthmind/shared";

import { createApiKeysRepo, stampApiKeyUse } from "../../src/repositories/api-keys.repo";
import {
  createDeliveriesRepo,
  type ClaimDeliveryInput,
} from "../../src/repositories/deliveries.repo";
import {
  ANALYSIS_RUN_LEASE_MS,
  createAnalysisRunsRepo,
  type CloseRunInput,
} from "../../src/repositories/analysis-runs.repo";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import type { SignatureHex } from "../../src/signatures/hex";
import { notifications, notificationSends } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  seedOrgWithOwner,
  seedProject,
  stubGraphileAddJob,
  type SeededOrgWithOwner,
  type TestDb,
  type TestDbHandle,
} from "../../src/testing";
import {
  connectSlackChannel,
  dispatchJobsOf,
  dispatchPayloadOf,
  drainBackfillCursor,
  loadDigest,
  loudPoster,
  recordHealthOf,
  runAllDispatchJobs,
  silentLogger,
} from "../helpers/o051-contracts";

const NAMES = laneNames("send-invariant");

const CHANNEL = "C0INVARIANT";

// 2026-08-10 is a Monday, so an org with no settings row is due by default (ADD D-6/D-8).
const DIGEST_MONDAY = new Date("2026-08-10T12:00:00.000Z");

const POLL_NOW = new Date("2026-08-06T18:00:00.000Z");

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

interface DriveBed {
  readonly db: TestDb;
  readonly org: SeededOrgWithOwner;
}

type DriveFn = (bed: DriveBed) => Promise<void>;

type Drive =
  | { readonly arm: "copied"; readonly drive: DriveFn }
  | { readonly arm: "owed"; readonly drive: DriveFn }
  | { readonly arm: "quiet_digest"; readonly drive: DriveFn };

const RENDERED: RenderedMessage = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [{ kind: "section", text: "*/checkout*\nThe payment step is losing sessions" }],
  text: "/checkout\nThe payment step is losing sessions",
  legibility: { characters: 43, lines: 2 },
};

async function driveFindingDelivered({ db, org }: DriveBed): Promise<void> {
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName("copied"),
  });
  const repo = createDeliveriesRepo(db, org.ctx);
  const claim: ClaimDeliveryInput = {
    projectId: project.id,
    findingId: "finding-invariant",
    signature: "c3d4".repeat(16) as unknown as SignatureHex,
    channelId: CHANNEL,
    claimedAt: new Date("2026-08-06T09:00:00.000Z"),
    staleClaimsBefore: new Date("2026-08-06T08:00:00.000Z"),
  };
  expect((await repo.claimForPost(claim)).claimed).toBe(true);
  await repo.markPosted({
    findingId: claim.findingId,
    channelId: CHANNEL,
    postedAt: new Date("2026-08-06T09:00:05.000Z"),
    messageRef: "1785481299.000300",
    renderedMessage: RENDERED,
  });
}

async function driveKeysRevoked({ db, org }: DriveBed): Promise<void> {
  const repo = createApiKeysRepo(db, org.ctx);
  await repo.mint({ name: "invariant agent" });
  expect(await repo.revokeEveryLive()).toBe(true);
}

async function driveAgentFirstContact({ db, org }: DriveBed): Promise<void> {
  const minted = await createApiKeysRepo(db, org.ctx).mint({ name: "invariant agent" });
  await stampApiKeyUse(db, minted.key.id);
}

async function driveKeyCreated({ db, org }: DriveBed): Promise<void> {
  await createApiKeysRepo(db, org.ctx).mint({ name: "invariant agent" });
}

async function driveSlackDisconnected({ db, org }: DriveBed): Promise<void> {
  const recordHealth = recordHealthOf(createSlackConnectionsRepo(db, org.ctx));
  await recordHealth({
    health: "failing",
    reasonCode: "call_failed",
    reasonMessage: null,
    checkedAt: new Date(),
  });
}

async function driveAnalysisFailing({ db, org }: DriveBed): Promise<void> {
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName("analysis"),
  });
  const repo = createAnalysisRunsRepo(db, org.ctx);
  const base = new Date("2026-08-01T09:00:00.000Z");

  for (const step of [0, 1, 2]) {
    const tickAt = new Date(base.getTime() + step * ANALYSIS_RUN_LEASE_MS);
    const { run } = await repo.open({ projectId: project.id, tickAt });
    const input: CloseRunInput = {
      runId: run.id,
      projectId: project.id,
      status: "failed",
      outcome: "no_candidates_passed_gate",
      stopReason: "fatal_error",
      finishedAt: new Date(tickAt.getTime() + 60_000),
      modelCallsAttempted: 0,
      candidatesUnrenderable: 0,
      candidatesRefused: 0,
      resolvedModelId: null,
      tokensIn: null,
      tokensOut: null,
      failureReason: "the analysis run could not finish",
    };
    await repo.close(input);
  }
}

async function driveDigest({ db, org }: DriveBed): Promise<void> {
  // One gathered fact inside the window, dated relative to the digest instant so the
  // drive stays deterministic on any wall-clock day.
  const [gathered] = await db
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
      createdAt: new Date(DIGEST_MONDAY.getTime() - 24 * 60 * 60 * 1_000),
    })
    .returning();
  if (!gathered) throw new Error("seeding the gathered row returned no row");
  await db.insert(notificationSends).values({
    organizationId: org.organizationId,
    notificationId: gathered.id,
    channel: "slack",
    target: "none",
    status: "quiet",
    quietReason: "digest",
  });

  const digest = await loadDigest();
  await digest({ db, now: () => DIGEST_MONDAY, logger: silentLogger });
}

async function driveBackfillComplete({ db, org }: DriveBed): Promise<void> {
  await drainBackfillCursor(db, org, POLL_NOW);
}

const EMITTER_DRIVES = {
  finding_delivered: { arm: "copied", drive: driveFindingDelivered },
  keys_revoked: { arm: "owed", drive: driveKeysRevoked },
  agent_first_contact: { arm: "owed", drive: driveAgentFirstContact },
  key_created: { arm: "owed", drive: driveKeyCreated },
  backfill_complete: { arm: "quiet_digest", drive: driveBackfillComplete },
  slack_disconnected: { arm: "owed", drive: driveSlackDisconnected },
  analysis_failing: { arm: "owed", drive: driveAnalysisFailing },
  digest: { arm: "owed", drive: driveDigest },
} as const satisfies Record<NotificationType, Drive>;

async function rowsOfType(db: TestDb, organizationId: string, type: NotificationType) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), eq(notifications.type, type)));
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

// Vacuous over zero rows, so every arm asserts its emit landed before calling this.
async function expectNoBareNotification(db: TestDb, organizationId: string): Promise<void> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.organizationId, organizationId));
  for (const row of rows) {
    const sends = await sendRowsFor(db, row.id);
    const slackSends = sends.filter((send) => send.channel === "slack");
    expect(`${row.type} carries ${String(slackSends.length)} slack receipt(s)`).not.toBe(
      `${row.type} carries 0 slack receipt(s)`,
    );
  }
}

test("the drive table is total over the enum — the runtime belt behind the satisfies", () => {
  expect(Object.keys(EMITTER_DRIVES).toSorted()).toEqual([...NOTIFICATION_TYPES].toSorted());
});

test("only a record goes into the digest, and the digest is the one record that does not", () => {
  for (const type of NOTIFICATION_TYPES) {
    const arm = EMITTER_DRIVES[type].arm;
    const klass = NOTIFICATION_CLASS_BY_TYPE[type];

    if (arm === "quiet_digest") {
      expect(`${type} in the digest is class ${klass}`).toBe(
        `${type} in the digest is class record`,
      );
    }
    if (klass !== "record") {
      expect(`${type} (${klass}) takes the ${arm} arm`).not.toBe(
        `${type} (${klass}) takes the quiet_digest arm`,
      );
    }
    if (klass === "record") {
      expect(arm === "quiet_digest" || type === "digest").toBe(true);
    }
  }

  // The one named exception: the digest is the vehicle, not the cargo — record class for
  // the mute semantics, live owed arm because a summary that waited for a summary would
  // never arrive (D-7).
  expect(NOTIFICATION_CLASS_BY_TYPE.digest).toBe("record");
  expect(EMITTER_DRIVES.digest.arm).toBe("owed");
});

for (const type of NOTIFICATION_TYPES) {
  const entry: Drive = EMITTER_DRIVES[type];

  if (entry.arm === "copied") {
    test(`${type}: the copied arm records the post that already happened, in the same commit`, async () => {
      const db = await openDb();
      const org = await seedOrg(db, `${type}-copied`);

      await entry.drive({ db, org });

      const rows = await rowsOfType(db, org.organizationId, type);
      expect(rows).toHaveLength(1);
      expect((await sendRowsFor(db, rows[0]?.id ?? "")).map((send) => send.status)).toEqual([
        "sent",
      ]);

      expect(dispatchJobsOf(await capturedJobs(db))).toHaveLength(0);
      await expectNoBareNotification(db, org.organizationId);
    });
  }

  if (entry.arm === "owed") {
    test(`${type}: the owed arm queues one dispatch job and the handler writes the sent receipt`, async () => {
      const db = await openDb();
      const org = await seedOrg(db, `${type}-owed`);
      await connectSlackChannel(db, org, CHANNEL);

      await entry.drive({ db, org });

      const rows = await rowsOfType(db, org.organizationId, type);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) throw new Error("unreachable: length was asserted above");

      const jobsForRow = dispatchJobsOf(await capturedJobs(db)).filter(
        (job) => dispatchPayloadOf(job).notificationId === row.id,
      );
      expect(jobsForRow).toHaveLength(1);

      // Every queued job runs, not only this type's: a drive that mints a key also owes
      // that key's own notification a receipt before the bare-row sweep below.
      await runAllDispatchJobs(db, loudPoster().poster);

      expect((await sendRowsFor(db, row.id)).map((send) => send.status)).toEqual(["sent"]);
      await expectNoBareNotification(db, org.organizationId);
    });
  }

  if (entry.arm === "quiet_digest") {
    test(`${type}: the quiet_digest arm records its deferral even though a channel exists`, async () => {
      const db = await openDb();
      const org = await seedOrg(db, `${type}-deferred`);
      await connectSlackChannel(db, org, CHANNEL);

      await entry.drive({ db, org });

      const rows = await rowsOfType(db, org.organizationId, type);
      expect(rows).toHaveLength(1);
      expect(
        (await sendRowsFor(db, rows[0]?.id ?? "")).map((send) => [send.status, send.quietReason]),
      ).toEqual([["quiet", "digest"]]);

      expect(dispatchJobsOf(await capturedJobs(db))).toHaveLength(0);
      await expectNoBareNotification(db, org.organizationId);
    });
  }
}
