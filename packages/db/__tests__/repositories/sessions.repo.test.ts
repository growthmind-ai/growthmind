import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { IdentityResolution, TenantContext } from "@growthmind/shared";

import { createSessionsRepo, type SessionUpsertRow } from "../../src/repositories/sessions.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../../src/testing";
import { seedConnection, seedOrgWithOwner, seedProject, seedSession } from "../../src/testing";

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

  describe("listSessions", () => {
    it("excludes sessions with a null identityEmailDomain, and a synthetic one from the real lane", async () => {
      const { ctx, projectId, connectionId } = await setUp(db, "groupable-null-domain");
      const repo = createSessionsRepo(db, ctx);

      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-groupable-with-domain",
        identityEmailDomain: "acme.example",
        startedAt: MIDDLE,
      });
      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-groupable-no-domain",
        identityEmailDomain: null,
        startedAt: LATE,
      });
      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-groupable-synthetic",
        identityEmailDomain: "acme.example",
        origin: "synthetic",
        startedAt: LATE,
      });

      const result = await repo.listSessions(
        { projectId, lane: "real", hasIdentityEmailDomain: true },
        { limit: 50 },
      );

      expect(result.sessions.map((session) => session.sessionKey)).toEqual([
        "ph:db-se-groupable-with-domain",
      ]);
      expect(result.truncated).toBe(false);

      const simulated = await repo.listSessions(
        { projectId, lane: "simulated", hasIdentityEmailDomain: true },
        { limit: 50 },
      );
      expect(simulated.sessions.map((session) => session.sessionKey)).toEqual([
        "ph:db-se-groupable-synthetic",
      ]);
    });

    it("orders by startedAt descending and sets truncated:true when a seeded limit+1 rows exceeds the cap", async () => {
      const { ctx, projectId, connectionId } = await setUp(db, "groupable-truncate");
      const repo = createSessionsRepo(db, ctx);
      const limit = 3;
      const times = [EARLY, MIDDLE, LATE, new Date("2026-07-30T12:00:00.000Z")];

      for (const [index, startedAt] of times.entries()) {
        await seedSession(db, {
          organizationId: ctx.organizationId,
          projectId,
          connectionId,
          sessionKey: `ph:db-se-groupable-truncate-${String(index)}`,
          identityEmailDomain: "acme.example",
          startedAt,
        });
      }

      const result = await repo.listSessions(
        { projectId, lane: "real", hasIdentityEmailDomain: true },
        { limit },
      );

      expect(result.sessions).toHaveLength(limit);
      expect(result.truncated).toBe(true);
      const startedAts = result.sessions.map((session) => session.startedAt.getTime());
      expect(startedAts).toEqual([...startedAts].toSorted((a, b) => b - a));
    });

    it("returns only sessions matching the exact domain in the named lane, most recent first, when two domains are seeded in the same project", async () => {
      const { ctx, projectId, connectionId } = await setUp(db, "domain-filter");
      const repo = createSessionsRepo(db, ctx);

      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-domain-a-1",
        identityEmailDomain: "acme.example",
        startedAt: EARLY,
      });
      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-domain-a-2",
        identityEmailDomain: "acme.example",
        startedAt: LATE,
      });
      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-domain-a-internal",
        identityEmailDomain: "acme.example",
        exclusionReason: "internal_domain",
        startedAt: LATE,
      });
      await seedSession(db, {
        organizationId: ctx.organizationId,
        projectId,
        connectionId,
        sessionKey: "ph:db-se-domain-b-1",
        identityEmailDomain: "other.example",
        startedAt: MIDDLE,
      });

      const result = await repo.listSessions(
        { projectId, lane: "real", identityEmailDomain: "acme.example" },
        { limit: 50 },
      );

      expect(result.sessions.map((session) => session.sessionKey)).toEqual([
        "ph:db-se-domain-a-2",
        "ph:db-se-domain-a-1",
      ]);
      expect(result.truncated).toBe(false);

      const excluded = await repo.listSessions(
        { projectId, lane: "excluded", identityEmailDomain: "acme.example" },
        { limit: 50 },
      );
      expect(excluded.sessions.map((session) => session.sessionKey)).toEqual([
        "ph:db-se-domain-a-internal",
      ]);
    });

    it("sets truncated:true when one domain's session count exceeds cap", async () => {
      const { ctx, projectId, connectionId } = await setUp(db, "domain-truncate");
      const repo = createSessionsRepo(db, ctx);
      const limit = 2;

      for (const [index, startedAt] of [EARLY, MIDDLE, LATE].entries()) {
        await seedSession(db, {
          organizationId: ctx.organizationId,
          projectId,
          connectionId,
          sessionKey: `ph:db-se-domain-truncate-${String(index)}`,
          identityEmailDomain: "acme.example",
          startedAt,
        });
      }

      const result = await repo.listSessions(
        { projectId, lane: "real", identityEmailDomain: "acme.example" },
        { limit },
      );

      expect(result.sessions).toHaveLength(limit);
      expect(result.truncated).toBe(true);
    });
  });
});
