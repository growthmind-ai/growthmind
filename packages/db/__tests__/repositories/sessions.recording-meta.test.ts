import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { TenantContext } from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import {
  createSessionsRepo,
  type RecordingMetaStamp,
  type SessionRecord,
  type SessionUpsertRow,
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
  activeSeconds: 30,
  clickCount: 7,
  keypressCount: 3,
  consoleErrorCount: 2,
};

interface Lane {
  ctx: TenantContext;
  projectId: string;
  connectionId: string;
}

const INGESTED = new Date("2026-08-05T09:00:00.000Z");

function upsertRow(lane: Lane, sessionKey: string): SessionUpsertRow {
  return {
    projectId: lane.projectId,
    connectionId: lane.connectionId,
    sessionKey,
    identityKey: null,
    identityEmailDomain: null,
    identityResolution: "unresolved",
    userAgent: null,
    entryUrlPath: "/pricing",
    startedAt: INGESTED,
    lastEventAt: INGESTED,
    origin: "real",
    exclusionReason: "none",
    internalDomainAtStamp: null,
    exclusionRuleSetVersion: 1,
    groupingVersion: 1,
  };
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
    recordingActiveSeconds: _active,
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
    expect(after?.recordingActiveSeconds).toBe(30);
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
    expect(rows[0]?.recordingActiveSeconds).toBe(30);
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
    expect(row?.recordingActiveSeconds).toBeNull();
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
      activeSeconds: 0,
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

  // The pair below is the null/zero rule on the fifth column, and it stays two cases. A
  // session someone opened and never touched has zero active seconds and that is a
  // measurement; a session we never measured has none. Parameterising them would assert
  // that those two rows are the same row, which is the whole thing they exist to deny.
  it("should leave active seconds null on a row that was never stamped", async () => {
    const lane = await setUp(db, "active-null");
    const repo = createSessionsRepo(db, lane.ctx);
    const sessionKey = "ph:db-rm-active-null";

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey,
    });

    const row = await repo.findByKey(lane.projectId, sessionKey);

    expect(row).not.toBeNull();
    expect(row?.recordingActiveSeconds).toBeNull();
  });

  it("should write a measured zero of active seconds as zero", async () => {
    const lane = await setUp(db, "active-zero");
    const repo = createSessionsRepo(db, lane.ctx);
    const sessionKey = "ph:db-rm-active-zero";

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey,
    });

    await repo.stampRecordingMeta(lane.projectId, sessionKey, { ...STAMP, activeSeconds: 0 });

    const row = await repo.findByKey(lane.projectId, sessionKey);

    expect(row?.recordingActiveSeconds).toBe(0);
    expect(row?.recordingDurationSeconds).toBe(42);
  });

  // The row mirrors the newest listing rather than accumulating across listings, so a key the
  // source has stopped reporting clears rather than persisting a measurement the source no
  // longer makes. Decision 0020 forbids inventing a value; it does not license keeping a stale
  // one, and a coalescing stamp could never correct a wrong value either.
  it("should clear a previously measured value when a later stamp omits it", async () => {
    const lane = await setUp(db, "unstamp");
    const repo = createSessionsRepo(db, lane.ctx);
    const sessionKey = "ph:db-rm-unstamp";

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey,
    });

    await repo.stampRecordingMeta(lane.projectId, sessionKey, STAMP);
    await repo.stampRecordingMeta(lane.projectId, sessionKey, { ...STAMP, activeSeconds: null });

    const row = await repo.findByKey(lane.projectId, sessionKey);
    expect(row?.recordingActiveSeconds).toBeNull();
    expect(row?.recordingDurationSeconds).toBe(42);
    expect(row?.recordingClickCount).toBe(7);
  });

  // The five columns survive re-ingest only because `upsertMany`'s conflict clause never names
  // them. Adding one to that `set` block would wipe every badge on the next poll, silently.
  it("should leave the stamp untouched when the same session is ingested again", async () => {
    const lane = await setUp(db, "reingest");
    const repo = createSessionsRepo(db, lane.ctx);
    const sessionKey = "ph:db-rm-reingest";

    await repo.upsertMany([upsertRow(lane, sessionKey)]);
    await repo.stampRecordingMeta(lane.projectId, sessionKey, STAMP);

    await repo.upsertMany([
      {
        ...upsertRow(lane, sessionKey),
        lastEventAt: new Date("2026-08-05T09:30:00.000Z"),
        identityEmailDomain: "acme.example",
        identityResolution: "resolved",
      },
    ]);

    const row = await repo.findByKey(lane.projectId, sessionKey);
    expect(row?.identityEmailDomain).toBe("acme.example");
    expect(row?.recordingDurationSeconds).toBe(42);
    expect(row?.recordingActiveSeconds).toBe(30);
    expect(row?.recordingClickCount).toBe(7);
    expect(row?.recordingKeypressCount).toBe(3);
    expect(row?.recordingConsoleErrorCount).toBe(2);
  });
});
