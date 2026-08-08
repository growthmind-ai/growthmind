// D11 wire + once-ever (ADD §4 seam 3, D-2): the REAL stampApiKeyUse is the emitter of
// agent_first_contact, org id off the UPDATE's returned row, dedup key the type constant
// alone — one row per org, ever. RED in Wave 0: the seam edit does not exist yet.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import {
  buildAgentFirstContactDedupKey,
  credentialAad,
  encryptSecret,
  keyIdOf,
  NOTIFICATION_DISPATCH_TASK,
  type CredentialKey,
} from "@growthmind/shared";

import {
  API_KEY_USE_STAMP_INTERVAL_SECONDS,
  createApiKeysRepo,
  stampApiKeyUse,
} from "../../src/repositories/api-keys.repo";
import { createSlackConnectionsRepo } from "../../src/repositories/slack-connections.repo";
import { apiKeys } from "../../src/schema/api-keys";
import { notifications } from "../../src/schema/notifications";
import {
  capturedJobs,
  createTestDb,
  laneNames,
  recordPublishedTopics,
  seedOrgWithOwner,
  stubGraphileAddJob,
  type LiveRecorder,
  type SeededOrgWithOwner,
  type TestDb,
} from "../../src/testing";

const NAMES = laneNames("wire-first-contact");

const CHANNEL = "C0WIRECONTACT";
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
  readonly mint: (name: string) => Promise<string>;
  readonly stamp: (keyId: string) => Promise<void>;
}

async function bedFor(label: string): Promise<Bed> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });

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

  const recorder = recordPublishedTopics(db);
  const repo = createApiKeysRepo(db, org.ctx);

  return {
    org,
    recorder,
    mint: async (name) => (await repo.mint({ name })).key.id,
    stamp: (keyId) => stampApiKeyUse(recorder.db, keyId),
  };
}

// Scoped to the type under test: minting the fixture's key is now its own act_now emit, so
// an org-total count would measure the setup rather than the once-ever guarantee.
async function notificationRowsFor(organizationId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.type, "agent_first_contact"),
      ),
    );
}

async function lastUsedAtOf(keyId: string): Promise<Date | null> {
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
  if (!row) throw new Error(`wire-first-contact: no api_keys row for ${keyId}`);
  return row.lastUsedAt;
}

async function backdatePastInterval(keyId: string): Promise<void> {
  await db.execute(
    sql`update api_keys set last_used_at = now() - make_interval(secs => ${API_KEY_USE_STAMP_INTERVAL_SECONDS + 60}) where id = ${keyId}`,
  );
}

function topicCount(recorder: LiveRecorder, organizationId: string, topic: string): number {
  return recorder.published.filter(
    (payload) => payload.topic === topic && payload.organizationId === organizationId,
  ).length;
}

// Scoped to this org's agent_first_contact notification: the fixture's mint() queues its
// own dispatch job, which is not the once-ever guarantee under test.
async function dispatchJobsFor(organizationId: string) {
  const mine = new Set((await notificationRowsFor(organizationId)).map((row) => row.id));

  return (await capturedJobs(db)).filter(
    (job) =>
      job.task === NOTIFICATION_DISPATCH_TASK &&
      mine.has((job.payload as { notificationId?: string }).notificationId ?? ""),
  );
}

describe("stampApiKeyUse is the agent_first_contact emitter, exactly once per org, ever", () => {
  test("the first stamped use emits one notification with a null actor and queues dispatch", async () => {
    const bed = await bedFor("first");
    const keyId = await bed.mint("first-contact agent");

    await bed.stamp(keyId);

    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("the first stamp emitted no notification row");

    expect(row.type).toBe("agent_first_contact");
    expect(row.subjectKind).toBe("agent_key");
    expect(row.subjectId).toBe(keyId);

    // The principal is api-key:<id>, which the actor column's FK would reject — null by
    // design (ADD D-2), never a synthetic id.
    expect(row.actorUserId).toBeNull();
    expect(row.dedupKey).toBe(buildAgentFirstContactDedupKey());

    const jobs = await dispatchJobsFor(bed.org.organizationId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      organizationId: bed.org.organizationId,
      notificationId: row.id,
    });

    // Both facts announced: the setup panel's existing signal and the bell's new one.
    expect(topicCount(bed.recorder, bed.org.organizationId, "agent_connection")).toBe(1);
    expect(topicCount(bed.recorder, bed.org.organizationId, "notifications")).toBe(1);
  });

  test("a use inside the 300s window makes no attempt — stamp, row count and jobs all hold still", async () => {
    const bed = await bedFor("window");
    const keyId = await bed.mint("window agent");

    await bed.stamp(keyId);
    const first = await lastUsedAtOf(keyId);
    if (first === null) throw new Error("the first use left no stamp");

    await bed.stamp(keyId);

    expect((await lastUsedAtOf(keyId))?.getTime()).toBe(first.getTime());
    expect(await notificationRowsFor(bed.org.organizationId)).toHaveLength(1);
    expect(await dispatchJobsFor(bed.org.organizationId)).toHaveLength(1);
    expect(topicCount(bed.recorder, bed.org.organizationId, "agent_connection")).toBe(1);
  });

  test("a backdated post-300s re-stamp writes the stamp and re-publishes agent_connection, but never a second row and never an error", async () => {
    const bed = await bedFor("restamp");
    const keyId = await bed.mint("restamp agent");

    await bed.stamp(keyId);
    await backdatePastInterval(keyId);
    const aged = await lastUsedAtOf(keyId);
    if (aged === null) throw new Error("the backdate fixture left no stamp");

    // The 300s condition is byte-identical: this is a real UPDATE-returned-a-row path, so
    // the emit fires again, hits the org-unique conflict, and silently stands down (D3).
    await bed.stamp(keyId);

    const rewritten = await lastUsedAtOf(keyId);
    expect(rewritten?.getTime()).toBeGreaterThan(aged.getTime());

    expect(topicCount(bed.recorder, bed.org.organizationId, "agent_connection")).toBe(2);

    expect(await notificationRowsFor(bed.org.organizationId)).toHaveLength(1);
    expect(await dispatchJobsFor(bed.org.organizationId)).toHaveLength(1);
    expect(topicCount(bed.recorder, bed.org.organizationId, "notifications")).toBe(1);
  });

  test("a second key's first use in the same org still leaves one row, ever (AC-5)", async () => {
    const bed = await bedFor("second-key");
    const firstKey = await bed.mint("second-key agent one");
    const secondKey = await bed.mint("second-key agent two");

    await bed.stamp(firstKey);
    await bed.stamp(secondKey);

    // The second key's own stamp is real — the once-ever mechanism is the dedup key, not
    // a skipped write (D12: key ids churn; the constant key does not).
    expect(await lastUsedAtOf(secondKey)).toBeInstanceOf(Date);

    const rows = await notificationRowsFor(bed.org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(firstKey);
    expect(await dispatchJobsFor(bed.org.organizationId)).toHaveLength(1);
  });
});
