// Wave 0b (red), lane L3, fixture seed prefix `db-`. Add
// tasks/session-source-posthog-adapter/add.md items 73–74.
//
// The session upsert is the one place a retried worker task can corrupt data, so its
// conflict resolution is the contract: `started_at` takes the earliest, `last_event_at`
// the latest, the email domain is never erased once known, and `identity_resolution`
// upgrades monotonically along `unresolved → absent → resolved`. "We could not
// check this time" must never overwrite "we checked and found an email last time".
//
// `createSessionsRepo` is a typed-stub throw today, so every test fails on "not
// implemented".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { IdentityResolution, TenantContext } from "@growthmind/shared";

import { createSessionsRepo, type SessionUpsertRow } from "../../src/repositories/sessions.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

const NAMES = laneNames("se");

const EARLY = new Date("2026-07-30T09:00:00.000Z");
const MIDDLE = new Date("2026-07-30T10:00:00.000Z");
const LATE = new Date("2026-07-30T11:00:00.000Z");

function makeUpsertRow(
  params: { projectId: string; connectionId: string; sessionKey: string },
  overrides: Partial<SessionUpsertRow> = {},
): SessionUpsertRow {
  return {
    projectId: params.projectId,
    connectionId: params.connectionId,
    sessionKey: params.sessionKey,
    identityKey: "db-distinct-0001",
    identityEmailDomain: null,
    identityResolution: "unresolved",
    userAgent: null,
    entryUrlPath: "/pricing",
    startedAt: MIDDLE,
    lastEventAt: MIDDLE,
    origin: "real",
    exclusionReason: "none",
    internalDomainAtStamp: null,
    exclusionRuleSetVersion: 1,
    groupingVersion: 1,
    ...overrides,
  };
}

/** Seeds an org + project + connection and returns everything a session row needs to be
 * well-formed. */
async function setUp(
  db: TestDb,
  label: string,
): Promise<{ ctx: TenantContext; projectId: string; connectionId: string }> {
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

describe("sessions repository", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // -- item 73
  it("keeps one row and widens the window when the same session is upserted repeatedly", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "idempotent");
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-idempotent";
    const base = { projectId, connectionId, sessionKey };

    await repo.upsertMany([makeUpsertRow(base)]);
    await repo.upsertMany([makeUpsertRow(base, { startedAt: LATE, lastEventAt: LATE })]);
    await repo.upsertMany([makeUpsertRow(base, { startedAt: EARLY, lastEventAt: EARLY })]);

    const row = await repo.findByKey(projectId, sessionKey);
    expect(row).not.toBeNull();
    expect(row?.startedAt.getTime()).toBe(EARLY.getTime());
    expect(row?.lastEventAt.getTime()).toBe(LATE.getTime());

    const listed = await repo.listForProject(projectId, { limit: 50 });
    expect(listed.filter((session) => session.sessionKey === sessionKey)).toHaveLength(1);
  });

  // -- item 73 (return shape)
  it("returns the persisted rows from an upsert so the caller can key events to them", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "returning");
    const repo = createSessionsRepo(db, ctx);

    const returned = await repo.upsertMany([
      makeUpsertRow({ projectId, connectionId, sessionKey: "ph:db-se-returning-one" }),
      makeUpsertRow({ projectId, connectionId, sessionKey: "ph:db-se-returning-two" }),
    ]);

    expect(returned.map((row) => row.sessionKey).toSorted()).toEqual([
      "ph:db-se-returning-one",
      "ph:db-se-returning-two",
    ]);
    for (const row of returned) {
      expect(row.id).toBeTruthy();
      expect(row.organizationId).toBe(ctx.organizationId);
      expect(row.projectId).toBe(projectId);
    }

    // Re-applying the same batch must return the same row ids, or a retried worker task
    // would orphan the events it keyed to the first run.
    const replayed = await repo.upsertMany([
      makeUpsertRow({ projectId, connectionId, sessionKey: "ph:db-se-returning-one" }),
      makeUpsertRow({ projectId, connectionId, sessionKey: "ph:db-se-returning-two" }),
    ]);
    expect(replayed.map((row) => row.id).toSorted()).toEqual(
      returned.map((row) => row.id).toSorted(),
    );
  });

  // -- item 74
  it("upgrades identity resolution along unresolved to absent to resolved", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "upgrade");
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-upgrade";
    const base = { projectId, connectionId, sessionKey };

    await repo.upsertMany([makeUpsertRow(base, { identityResolution: "unresolved" })]);
    expect((await repo.findByKey(projectId, sessionKey))?.identityResolution).toBe("unresolved");

    await repo.upsertMany([makeUpsertRow(base, { identityResolution: "absent" })]);
    expect((await repo.findByKey(projectId, sessionKey))?.identityResolution).toBe("absent");

    await repo.upsertMany([
      makeUpsertRow(base, { identityResolution: "resolved", identityEmailDomain: "acme.example" }),
    ]);
    const resolved = await repo.findByKey(projectId, sessionKey);
    expect(resolved?.identityResolution).toBe("resolved");
    expect(resolved?.identityEmailDomain).toBe("acme.example");
  });

  // -- item 74 (no regression)
  it("never regresses identity resolution from resolved back to absent or unresolved", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "no-regress");
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-no-regress";
    const base = { projectId, connectionId, sessionKey };

    await repo.upsertMany([
      makeUpsertRow(base, { identityResolution: "resolved", identityEmailDomain: "acme.example" }),
    ]);

    // A later run whose identity budget was exhausted reports "unresolved". That is "we
    // could not check", not "there is nothing". It must not erase what an earlier run
    // established.
    for (const downgrade of ["unresolved", "absent"] satisfies IdentityResolution[]) {
      await repo.upsertMany([
        makeUpsertRow(base, { identityResolution: downgrade, identityEmailDomain: null }),
      ]);
      const row = await repo.findByKey(projectId, sessionKey);
      expect(row?.identityResolution).toBe("resolved");
      expect(row?.identityEmailDomain).toBe("acme.example");
    }
  });

  // -- item 74 (absent is not overwritten by unresolved)
  it("keeps a completed absent lookup rather than downgrading it to unresolved", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "absent");
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-absent";
    const base = { projectId, connectionId, sessionKey };

    await repo.upsertMany([makeUpsertRow(base, { identityResolution: "absent" })]);
    await repo.upsertMany([makeUpsertRow(base, { identityResolution: "unresolved" })]);

    // `absent` is a fact (a completed lookup proving no email); `unresolved` is an
    // admission of ignorance. The fact wins.
    expect((await repo.findByKey(projectId, sessionKey))?.identityResolution).toBe("absent");
  });

  // -- item 74 (scoped read boundary)
  it("returns null from findByKey for a session key that belongs to another project", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "other-project");
    const otherProject = await seedProject(db, {
      organizationId: ctx.organizationId,
      name: NAMES.projectName("other-project-two"),
    });
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-other-project";

    await repo.upsertMany([makeUpsertRow({ projectId, connectionId, sessionKey })]);

    expect(await repo.findByKey(otherProject.id, sessionKey)).toBeNull();
  });
});
