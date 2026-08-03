import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { IdentityResolution, TenantContext } from "@growthmind/shared";

import { createSessionsRepo, type SessionUpsertRow } from "../../src/repositories/sessions.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedConnection, seedOrgWithOwner, seedProject } from "../../src/testing";

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

    const replayed = await repo.upsertMany([
      makeUpsertRow({ projectId, connectionId, sessionKey: "ph:db-se-returning-one" }),
      makeUpsertRow({ projectId, connectionId, sessionKey: "ph:db-se-returning-two" }),
    ]);
    expect(replayed.map((row) => row.id).toSorted()).toEqual(
      returned.map((row) => row.id).toSorted(),
    );
  });

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

  it("never regresses identity resolution from resolved back to absent or unresolved", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "no-regress");
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-no-regress";
    const base = { projectId, connectionId, sessionKey };

    await repo.upsertMany([
      makeUpsertRow(base, { identityResolution: "resolved", identityEmailDomain: "acme.example" }),
    ]);

    for (const downgrade of ["unresolved", "absent"] satisfies IdentityResolution[]) {
      await repo.upsertMany([
        makeUpsertRow(base, { identityResolution: downgrade, identityEmailDomain: null }),
      ]);
      const row = await repo.findByKey(projectId, sessionKey);
      expect(row?.identityResolution).toBe("resolved");
      expect(row?.identityEmailDomain).toBe("acme.example");
    }
  });

  it("keeps a completed absent lookup rather than downgrading it to unresolved", async () => {
    const { ctx, projectId, connectionId } = await setUp(db, "absent");
    const repo = createSessionsRepo(db, ctx);
    const sessionKey = "ph:db-se-absent";
    const base = { projectId, connectionId, sessionKey };

    await repo.upsertMany([makeUpsertRow(base, { identityResolution: "absent" })]);
    await repo.upsertMany([makeUpsertRow(base, { identityResolution: "unresolved" })]);

    expect((await repo.findByKey(projectId, sessionKey))?.identityResolution).toBe("absent");
  });

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
