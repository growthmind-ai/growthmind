import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { TenantContext } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import {
  createSessionsRepo,
  type RecordingMetaStamp,
  type SessionRecord,
} from "../../src/repositories/sessions.repo";
import { sessions } from "../../src/schema/sessions";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
} from "../../src/testing";

const NAMES = laneNames("rm");

const STAMP: RecordingMetaStamp = {
  durationSeconds: 42,
  clickCount: 7,
  keypressCount: 3,
  consoleErrorCount: 2,
};

interface Lane {
  ctx: TenantContext;
  projectId: string;
  connectionId: string;
}

async function setUp(db: TestDb, label: string): Promise<Lane> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
  });

  return { ctx: org.ctx, projectId: project.id, connectionId: connection.id };
}

// Everything the stamp must leave alone. `updatedAt` moves by design, so it is dropped here
// rather than asserted.
function untouched(row: SessionRecord | null): Record<string, unknown> | null {
  if (row === null) return null;

  const {
    recordingDurationSeconds: _duration,
    recordingClickCount: _clicks,
    recordingKeypressCount: _keypresses,
    recordingConsoleErrorCount: _errors,
    updatedAt: _updatedAt,
    ...rest
  } = row;

  return rest;
}

// The identity scope the unique index enforces, read straight off the table rather than
// through a limit-1 lookup: a second row written by a replayed job is invisible to `findByKey`.
async function rowsFor(db: TestDb, projectId: string, sessionKey: string) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.sessionKey, sessionKey)));
}

describe("stampRecordingMeta", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("should write the four meta values onto the session row matching the project and session key", async () => {
    const lane = await setUp(db, "writes");
    const repo = createSessionsRepo(db, lane.ctx);
    const sessionKey = "ph:db-rm-writes";

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey,
      identityEmailDomain: "acme.example",
    });
    const before = await repo.findByKey(lane.projectId, sessionKey);

    await repo.stampRecordingMeta(lane.projectId, sessionKey, STAMP);

    const after = await repo.findByKey(lane.projectId, sessionKey);
    expect(after?.recordingDurationSeconds).toBe(42);
    expect(after?.recordingClickCount).toBe(7);
    expect(after?.recordingKeypressCount).toBe(3);
    expect(after?.recordingConsoleErrorCount).toBe(2);

    expect(untouched(after)).toEqual(untouched(before));
  });

  it("should leave the row identical when the same stamp is applied twice", async () => {
    const lane = await setUp(db, "replayed");
    const repo = createSessionsRepo(db, lane.ctx);
    const sessionKey = "ph:db-rm-replayed";

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey,
    });

    await repo.stampRecordingMeta(lane.projectId, sessionKey, STAMP);
    await repo.stampRecordingMeta(lane.projectId, sessionKey, STAMP);

    const rows = await rowsFor(db, lane.projectId, sessionKey);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recordingDurationSeconds).toBe(42);
    expect(rows[0]?.recordingClickCount).toBe(7);
    expect(rows[0]?.recordingKeypressCount).toBe(3);
    expect(rows[0]?.recordingConsoleErrorCount).toBe(2);
  });

  it("should be a no-op when no session row carries that session key", async () => {
    const lane = await setUp(db, "absent");
    const repo = createSessionsRepo(db, lane.ctx);
    const held = "ph:db-rm-absent-held";
    const missing = "ph:db-rm-absent-missing";

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: held,
    });

    const stamped = await repo.stampRecordingMeta(lane.projectId, missing, STAMP);

    expect(stamped).toBeNull();
    expect(await rowsFor(db, lane.projectId, missing)).toHaveLength(0);
    expect(await repo.listForProject(lane.projectId, { limit: 50 })).toHaveLength(1);
  });

  it("should not stamp a session row belonging to another organization", async () => {
    const orgA = await setUp(db, "tenant-a");
    const orgB = await setUp(db, "tenant-b");
    const sessionKey = "ph:db-rm-tenant";

    await seedSession(db, {
      organizationId: orgA.ctx.organizationId,
      projectId: orgA.projectId,
      connectionId: orgA.connectionId,
      sessionKey,
    });

    const stamped = await createSessionsRepo(db, orgB.ctx).stampRecordingMeta(
      orgA.projectId,
      sessionKey,
      STAMP,
    );

    expect(stamped).toBeNull();

    const row = await createSessionsRepo(db, orgA.ctx).findByKey(orgA.projectId, sessionKey);
    expect(row?.recordingDurationSeconds).toBeNull();
    expect(row?.recordingClickCount).toBeNull();
    expect(row?.recordingKeypressCount).toBeNull();
    expect(row?.recordingConsoleErrorCount).toBeNull();
  });

  it("should write a genuine zero as zero and never as null", async () => {
    const lane = await setUp(db, "zero");
    const repo = createSessionsRepo(db, lane.ctx);
    const stampedKey = "ph:db-rm-zero-stamped";
    const unstampedKey = "ph:db-rm-zero-unstamped";

    for (const sessionKey of [stampedKey, unstampedKey]) {
      await seedSession(db, {
        organizationId: lane.ctx.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionKey,
      });
    }

    await repo.stampRecordingMeta(lane.projectId, stampedKey, {
      durationSeconds: 0,
      clickCount: 0,
      keypressCount: 0,
      consoleErrorCount: 0,
    });

    const stamped = await repo.findByKey(lane.projectId, stampedKey);
    expect(stamped?.recordingClickCount).toBe(0);
    expect(stamped?.recordingConsoleErrorCount).toBe(0);

    const unstamped = await repo.findByKey(lane.projectId, unstampedKey);
    expect(unstamped?.recordingClickCount).toBeNull();
    expect(unstamped?.recordingConsoleErrorCount).toBeNull();
  });
});
