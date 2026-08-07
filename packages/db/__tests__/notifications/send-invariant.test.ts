// The class invariant (ADD §3, spec ruling): every actionable-class notification carries a
// Slack send row — sent, failed, or quiet with a stated reason. Proven BY CLASS: each job-1
// type's real emitter fixture is driven through every arm it can take (quiet at commit,
// queued → dispatch → sent, enqueue fault → failed), so the invariant has no unwitnessed
// arm. Per-test databases on purpose: the enqueue-fault arm NEEDS the default fixture (no
// graphile_worker schema), which an installed stub would silently turn into the queued path.
import { afterAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  ACTIONABLE_CLASSES,
  buildFindingDeliveredDedupKey,
  credentialAad,
  encryptSecret,
  keyIdOf,
  NOTIFICATION_CLASS_BY_TYPE,
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_SEND_NO_TARGET,
  NOTIFICATION_TYPES,
  RENDERED_MESSAGE_VERSION,
  type CredentialKey,
  type DeliveryPoster,
  type PostRequest,
  type PostResult,
  type RenderedMessage,
  type TenantContext,
} from "@growthmind/shared";

import {
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../shared/__tests__/onboarding/module-under-construction";
import { createApiKeysRepo, stampApiKeyUse } from "../../src/repositories/api-keys.repo";
import {
  createDeliveriesRepo,
  type ClaimDeliveryInput,
} from "../../src/repositories/deliveries.repo";
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

const NAMES = laneNames("send-invariant");

const CHANNEL = "C0INVARIANT";
const KEY: CredentialKey = { bytes: Uint8Array.from({ length: 32 }, (_, index) => index) };
const DISPATCH_OWNER = "O-051 tasks 0.3/2.3 (worker/src/tasks/notification-dispatch.ts)";

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
    channelId: CHANNEL,
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

// The emitter fixtures — each drives the REAL repository write for its type.
async function driveKeysRevoked(db: TestDb, org: SeededOrgWithOwner): Promise<void> {
  const repo = createApiKeysRepo(db, org.ctx);
  await repo.mint({ name: "invariant agent" });
  expect(await repo.revokeEveryLive()).toBe(true);
}

async function driveAgentFirstContact(db: TestDb, org: SeededOrgWithOwner): Promise<void> {
  const minted = await createApiKeysRepo(db, org.ctx).mint({ name: "invariant agent" });
  await stampApiKeyUse(db, minted.key.id);
}

const RENDERED: RenderedMessage = {
  version: RENDERED_MESSAGE_VERSION,
  blocks: [{ kind: "section", text: "*/checkout*\nThe payment step is losing sessions" }],
  text: "/checkout\nThe payment step is losing sessions",
  legibility: { characters: 43, lines: 2 },
};

async function driveFindingDelivered(db: TestDb, org: SeededOrgWithOwner): Promise<void> {
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

async function notificationRowsFor(db: TestDb, organizationId: string) {
  return db.select().from(notifications).where(eq(notifications.organizationId, organizationId));
}

async function sendRowsFor(db: TestDb, notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

// The invariant itself. Vacuous over zero rows, so every arm first asserts its emit landed.
async function expectNoBareNotification(db: TestDb, organizationId: string): Promise<void> {
  const rows = await notificationRowsFor(db, organizationId);
  for (const row of rows) {
    const sends = await sendRowsFor(db, row.id);
    const slackSends = sends.filter((send) => send.channel === "slack");
    expect(
      `${row.type} carries ${String(slackSends.length)} slack receipt(s)`,
    ).not.toBe(`${row.type} carries 0 slack receipt(s)`);
  }
}

interface LoudPoster {
  readonly poster: DeliveryPoster;
  readonly posted: PostRequest[];
}

function loudPoster(): LoudPoster {
  const posted: PostRequest[] = [];
  return {
    posted,
    poster: {
      post(request: PostRequest): Promise<PostResult> {
        posted.push(request);
        return Promise.resolve({ ok: true, messageRef: `invariant-ref-${String(posted.length)}` });
      },
    },
  };
}

interface MirrorNotificationDispatchDeps {
  readonly db: TestDb;
  readonly posterFor: (ctx: TenantContext) => Promise<DeliveryPoster | null>;
  readonly logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

type MirrorRunNotificationDispatch = (
  payload: unknown,
  deps: MirrorNotificationDispatchDeps,
) => Promise<void>;

const loadDispatch = (): Promise<MirrorRunNotificationDispatch> =>
  loadUnderConstruction<MirrorRunNotificationDispatch>({
    modulePath: underConstructionSpecifier("worker/src/tasks/notification-dispatch"),
    exportName: "runNotificationDispatch",
    ownedBy: DISPATCH_OWNER,
  });

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

test("every job-1 type is actionable — the invariant applies to the whole enum", () => {
  const actionable: readonly string[] = ACTIONABLE_CLASSES;
  for (const type of NOTIFICATION_TYPES) {
    expect(actionable).toContain(NOTIFICATION_CLASS_BY_TYPE[type]);
  }
});

describe("finding_delivered: the copied arm is the receipt", () => {
  test("markPosted leaves a sent receipt beside the fact — no arm exists without one", async () => {
    const db = await openDb();
    const org = await seedOrg(db, "copied");
    await stubGraphileAddJob(db);

    await driveFindingDelivered(db, org);

    const rows = await notificationRowsFor(db, org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dedupKey).toBe(buildFindingDeliveredDedupKey("finding-invariant", CHANNEL));
    expect((await sendRowsFor(db, rows[0]?.id ?? "")).map((send) => send.status)).toEqual(["sent"]);

    await expectNoBareNotification(db, org.organizationId);
    expect(await capturedJobs(db)).toEqual([]);
  });
});

const OWED_EMITTERS = [
  { type: "keys_revoked", drive: driveKeysRevoked },
  { type: "agent_first_contact", drive: driveAgentFirstContact },
] as const;

for (const { type, drive } of OWED_EMITTERS) {
  describe(`${type}: every owed arm leaves a receipt`, () => {
    test("no Slack connection → the quiet no_channel receipt lands in the same commit", async () => {
      const db = await openDb();
      const org = await seedOrg(db, `${type}-quiet`);
      await stubGraphileAddJob(db);

      await drive(db, org);

      const rows = await notificationRowsFor(db, org.organizationId);
      expect(rows).toHaveLength(1);
      const sends = await sendRowsFor(db, rows[0]?.id ?? "");
      expect(sends.map((send) => [send.status, send.quietReason, send.target])).toEqual([
        ["quiet", "no_channel", NOTIFICATION_SEND_NO_TARGET],
      ]);

      await expectNoBareNotification(db, org.organizationId);
      expect(await capturedJobs(db)).toEqual([]);
    });

    test("a connection → the queued job, and the dispatch handler writes the sent receipt", async () => {
      const db = await openDb();
      const org = await seedOrg(db, `${type}-queued`);
      await connectSlack(db, org);
      await stubGraphileAddJob(db);

      await drive(db, org);

      const rows = await notificationRowsFor(db, org.organizationId);
      expect(rows).toHaveLength(1);

      const jobs = await capturedJobs(db);
      expect(jobs.map((job) => job.task)).toEqual([NOTIFICATION_DISPATCH_TASK]);

      const run = await loadDispatch();
      const loud = loudPoster();
      await run(jobs[0]?.payload, {
        db,
        posterFor: () => Promise.resolve(loud.poster),
        logger: silentLogger,
      });

      expect(loud.posted).toHaveLength(1);
      const sends = await sendRowsFor(db, rows[0]?.id ?? "");
      expect(sends.map((send) => send.status)).toEqual(["sent"]);

      await expectNoBareNotification(db, org.organizationId);
    });

    test("an enqueue fault → the failed queue_unavailable receipt, never a bare notification", async () => {
      // No stubGraphileAddJob: the embedded database has no graphile_worker schema, which
      // is exactly the fresh-clone web boot the fault arm exists for (D-1 amendment 2).
      const db = await openDb();
      const org = await seedOrg(db, `${type}-fault`);
      await connectSlack(db, org);

      await drive(db, org);

      const rows = await notificationRowsFor(db, org.organizationId);
      expect(rows).toHaveLength(1);
      const sends = await sendRowsFor(db, rows[0]?.id ?? "");
      expect(sends.map((send) => [send.status, send.failureReason])).toEqual([
        ["failed", "queue_unavailable"],
      ]);

      await expectNoBareNotification(db, org.organizationId);
    });
  });
}
