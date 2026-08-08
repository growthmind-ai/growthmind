// D11 wire (ADD §4 seam 2): the REAL revokeEveryLive() is the emitter of keys_revoked —
// the anyRevoked gate (the UPDATE returning a row) is what makes one real transition one
// emit. RED in Wave 0: the seam edit does not exist yet.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import {
  buildKeysRevokedDedupKey,
  credentialAad,
  encryptSecret,
  keyIdOf,
  NOTIFICATION_DISPATCH_TASK,
  NOTIFICATION_SEND_NO_TARGET,
  type CredentialKey,
} from "@growthmind/shared";

import { createApiKeysRepo } from "../../src/repositories/api-keys.repo";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { notifications, notificationSends } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  recordPublishedTopics,
  seedMember,
  seedOrgWithOwner,
  seedUser,
  stubGraphileAddJob,
  type LiveRecorder,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("wire-keys-revoked");

const CHANNEL = "C0WIREREVOKE";
const KEY: CredentialKey = { bytes: Uint8Array.from({ length: 32 }, (_, index) => index) };

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await stubGraphileAddJob(db);
});

afterAll(async () => {
  await close();
});

interface Bed {
  readonly org: SeededOrgWithOwner;
  readonly recorder: LiveRecorder;
  readonly repo: ReturnType<typeof createApiKeysRepo>;
  readonly mintSetup: (name: string) => Promise<unknown>;
}

async function bedFor(label: string, options: { readonly slack: boolean }): Promise<Bed> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });

  if (options.slack) {
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

  const recorder = recordPublishedTopics(db);

  return {
    org,
    recorder,
    repo: createApiKeysRepo(recorder.db, org.ctx),

    // Minting is this suite's setup, and it is its own emit now. Off the recorder, so what
    // the recorder holds is the transition under test and nothing else.
    mintSetup: (name: string) => createApiKeysRepo(db, org.ctx).mint({ name }),
  };
}

// This suite's claim is about `keys_revoked` and nothing else. Minting a key is now its own
// act_now emit, so an org-total count would fail on the fixture's setup rather than on the
// transition under test.
async function notificationRowsFor(organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.organizationId, organizationId), eq(notifications.type, "keys_revoked")),
    );
}

async function sendRowsFor(notificationId: string) {
  return db
    .select()
    .from(notificationSends)
    .where(eq(notificationSends.notificationId, notificationId));
}

function notificationsTopicFor(recorder: LiveRecorder, organizationId: string) {
  return recorder.published.filter(
    (payload) => payload.topic === "notifications" && payload.organizationId === organizationId,
  );
}

// Scoped to the org's keys_revoked notifications only: minting the fixture's keys queues
// its own dispatch job now, and an org-wide count would measure the setup.
async function dispatchJobsFor(organizationId: string) {
  const mine = new Set((await notificationRowsFor(organizationId)).map((row) => row.id));

  return (await capturedJobs(db)).filter(
    (job) =>
      job.task === NOTIFICATION_DISPATCH_TASK &&
      mine.has((job.payload as { notificationId?: string }).notificationId ?? ""),
  );
}

describe("the actor is whoever pressed revoke, not the org's owner (D1)", () => {
  // The retired route suite owned this one: with a single-member fixture, resolving the
  // owner and resolving the actor are the same value, so nothing would catch a regression
  // that read the org owner instead of the caller.
  test("a teammate revoking is named as the actor, not the owner", async () => {
    const bed = await bedFor("d1-actor", { slack: false });

    const teammate = await seedUser(db, {
      name: "o051-teammate-who-pressed-revoke",
      email: `o051-teammate-${bed.org.organizationId}@example.com`,
    });
    await seedMember(db, { organizationId: bed.org.organizationId, userId: teammate.id });

    await createApiKeysRepo(db, bed.org.ctx).mint({ name: "o051-d1-key" });

    const asTeammate = createApiKeysRepo(db, { ...bed.org.ctx, userId: teammate.id });
    expect(await asTeammate.revokeEveryLive()).toBe(true);

    const rows = await notificationRowsFor(bed.org.organizationId);
    const row = rows.at(-1);
    if (!row) throw new Error("the teammate's revoke emitted no notification");

    expect(row.actorUserId).toBe(teammate.id);
    expect(row.actorUserId).not.toBe(bed.org.userId);
  });
});

describe("revokeEveryLive is the keys_revoked emitter (D11 wire)", () => {
  test("revoking live keys emits once with the acting member as actor and queues the dispatch job", async () => {
    const bed = await bedFor("live", { slack: true });
    await bed.mintSetup("wire agent one");
    await bed.mintSetup("wire agent two");

    const revoked = await bed.repo.revokeEveryLive();
    expect(revoked).toBe(true);

    // Three keys died in one transition; the org hears about it once (D3).
    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("revokeEveryLive emitted no notification row");

    expect(row.type).toBe("keys_revoked");
    expect(row.subjectKind).toBe("agent_key");
    expect(row.actorUserId).toBe(bed.org.userId);
    expect(row.audience).toBe("org");

    // The dedup key is built from the minted event id the repo wrote as the subject (D12:
    // stable minted ids only — nothing display-derived can be in here).
    expect(row.dedupKey).toBe(buildKeysRevokedDedupKey(row.subjectId));

    const jobs = await dispatchJobsFor(bed.org.organizationId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      organizationId: bed.org.organizationId,
      notificationId: row.id,
    });
    expect(jobs[0]?.jobKey).toBe(`notification:dispatch:${row.id}`);

    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toEqual([
      { organizationId: bed.org.organizationId, topic: "notifications" },
    ]);

    // The receipt belongs to the dispatch task; the emit queued, it did not send.
    expect(await sendRowsFor(row.id)).toEqual([]);
  });

  test("a second revoke that finds nothing live emits nothing — the transition gate, not the call, decides", async () => {
    const bed = await bedFor("retry", { slack: true });
    await bed.mintSetup("retry agent");

    expect(await bed.repo.revokeEveryLive()).toBe(true);
    expect(await notificationRowsFor(bed.org.organizationId)).toHaveLength(1);

    expect(await bed.repo.revokeEveryLive()).toBe(false);

    expect(await notificationRowsFor(bed.org.organizationId)).toHaveLength(1);
    expect(await dispatchJobsFor(bed.org.organizationId)).toHaveLength(1);
    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toHaveLength(1);
  });

  test("a no-Slack org gets the quiet no_channel receipt at commit instead of a job (self-host path)", async () => {
    const bed = await bedFor("quiet", { slack: false });
    await bed.mintSetup("quiet agent");

    expect(await bed.repo.revokeEveryLive()).toBe(true);

    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("revokeEveryLive emitted no notification row");

    const sends = await sendRowsFor(row.id);
    expect(sends).toHaveLength(1);
    const send = sends[0];
    if (!send) throw new Error("the quiet path left the notification bare");
    expect(send.channel).toBe("slack");
    expect(send.status).toBe("quiet");
    expect(send.quietReason).toBe("no_channel");
    expect(send.target).toBe(NOTIFICATION_SEND_NO_TARGET);

    expect(await dispatchJobsFor(bed.org.organizationId)).toEqual([]);

    // Silence still reaches the bell: the row landed, so open pages are told.
    expect(notificationsTopicFor(bed.recorder, bed.org.organizationId)).toHaveLength(1);
  });

  test("the boolean return contract is unchanged by the seam edit", async () => {
    const bed = await bedFor("signature", { slack: false });

    expect(await bed.repo.revokeEveryLive()).toBe(false);

    await bed.mintSetup("signature agent");
    expect(await bed.repo.revokeEveryLive()).toBe(true);
  });
});
