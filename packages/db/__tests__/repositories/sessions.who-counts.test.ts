import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { laneOf } from "@growthmind/core";
import { REPLAY_LANES, stampedExclusionReasonSchema } from "@growthmind/shared";
import type { ReplayLane, ReplaySessionFact, TenantContext } from "@growthmind/shared";

import {
  createSessionsRepo,
  type SessionListFilter,
  type SessionRecord,
} from "../../src/repositories/sessions.repo";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
} from "../../src/testing";

const NAMES = laneNames("wc");

// A filter with no lane is not a filter. Stated as a type so the lane-blind read the old
// listGroupableSessions expressed cannot be written again (ADD D-3).
const LANE_IS_REQUIRED: Omit<SessionListFilter, "lane"> extends SessionListFilter ? true : false =
  false;

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

// packages/core reads a structural fact, never a row. The lane rule reads none of the
// recording meta, so it is carried as null here rather than mirrored off the row.
function factOf(row: SessionRecord): ReplaySessionFact {
  return {
    sessionKey: row.sessionKey,
    startedAt: row.startedAt,
    identityEmailDomain: row.identityEmailDomain,
    entryUrlPath: row.entryUrlPath,
    origin: row.origin,
    exclusionReason: row.exclusionReason,
    durationMs: null,
    clickCount: null,
    keypressCount: null,
    consoleErrorCount: null,
  };
}

describe("listSessions", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("should return one row for a domain holding one real and one excluded session when the lane is real", async () => {
    const lane = await setUp(db, "real-lane");
    const repo = createSessionsRepo(db, lane.ctx);

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: "ph:db-wc-real",
      identityEmailDomain: "acme.example",
      exclusionReason: "none",
    });
    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: "ph:db-wc-internal",
      identityEmailDomain: "acme.example",
      exclusionReason: "internal_domain",
    });

    const result = await repo.listSessions(
      { projectId: lane.projectId, lane: "real", identityEmailDomain: "acme.example" },
      { limit: 50 },
    );

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.sessionKey).toBe("ph:db-wc-real");
  });

  it("should omit a synthetic-origin session from the real lane and return it in the simulated lane", async () => {
    const lane = await setUp(db, "simulated");
    const repo = createSessionsRepo(db, lane.ctx);

    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: "ph:db-wc-sim-real",
      origin: "real",
    });
    await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: "ph:db-wc-sim-synthetic",
      origin: "synthetic",
    });

    const real = await repo.listSessions(
      { projectId: lane.projectId, lane: "real" },
      { limit: 50 },
    );
    const simulated = await repo.listSessions(
      { projectId: lane.projectId, lane: "simulated" },
      { limit: 50 },
    );

    expect(real.sessions.map((session) => session.sessionKey)).toEqual(["ph:db-wc-sim-real"]);
    expect(simulated.sessions.map((session) => session.sessionKey)).toEqual([
      "ph:db-wc-sim-synthetic",
    ]);
  });

  it("should return the excluded session and not the real one in the excluded lane", async () => {
    const lane = await setUp(db, "excluded");
    const repo = createSessionsRepo(db, lane.ctx);

    const real = await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: "ph:db-wc-exc-real",
      exclusionReason: "none",
    });
    const excluded = await seedSession(db, {
      organizationId: lane.ctx.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: "ph:db-wc-exc-headless",
      exclusionReason: "automation_headless",
    });

    const result = await repo.listSessions(
      { projectId: lane.projectId, lane: "excluded" },
      { limit: 50 },
    );

    expect(result.sessions.map((session) => session.id)).toEqual([excluded.id]);
    expect(result.sessions.map((session) => session.id)).not.toContain(real.id);
  });

  it("should return every lane only when the caller writes every_lane", async () => {
    const lane = await setUp(db, "every-lane");
    const repo = createSessionsRepo(db, lane.ctx);

    const seeded = [
      { sessionKey: "ph:db-wc-all-real", origin: "real", exclusionReason: "none" },
      { sessionKey: "ph:db-wc-all-excluded", origin: "real", exclusionReason: "internal_domain" },
      { sessionKey: "ph:db-wc-all-synthetic", origin: "synthetic", exclusionReason: "none" },
    ] as const;

    for (const row of seeded) {
      await seedSession(db, {
        organizationId: lane.ctx.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionKey: row.sessionKey,
        origin: row.origin,
        exclusionReason: row.exclusionReason,
      });
    }

    const everyLane = await repo.listSessions(
      { projectId: lane.projectId, lane: "every_lane" },
      { limit: 50 },
    );
    const realOnly = await repo.listSessions(
      { projectId: lane.projectId, lane: "real" },
      { limit: 50 },
    );

    expect(everyLane.sessions.map((session) => session.sessionKey).toSorted()).toEqual(
      seeded.map((row) => row.sessionKey).toSorted(),
    );
    expect(realOnly.sessions).toHaveLength(1);
  });

  it("should agree with laneOf for every seeded session shape", async () => {
    const lane = await setUp(db, "anti-drift");
    const repo = createSessionsRepo(db, lane.ctx);
    const origins = ["real", "synthetic"] as const;
    let seededCount = 0;

    for (const origin of origins) {
      for (const reason of stampedExclusionReasonSchema.options) {
        await seedSession(db, {
          organizationId: lane.ctx.organizationId,
          projectId: lane.projectId,
          connectionId: lane.connectionId,
          sessionKey: `ph:db-wc-drift-${origin}-${reason}`,
          origin,
          exclusionReason: reason,
        });
        seededCount += 1;
      }
    }

    const placed: string[] = [];

    for (const replayLane of REPLAY_LANES) {
      const result = await repo.listSessions(
        { projectId: lane.projectId, lane: replayLane },
        { limit: 50 },
      );

      for (const row of result.sessions) {
        expect(laneOf(factOf(row))).toBe(replayLane as ReplayLane);
        placed.push(row.sessionKey);
      }
    }

    expect(placed).toHaveLength(seededCount);
    expect(new Set(placed).size).toBe(seededCount);
  });

  it("should preserve the boundedList truncation contract", async () => {
    const lane = await setUp(db, "truncate");
    const repo = createSessionsRepo(db, lane.ctx);
    const limit = 3;

    for (let index = 0; index < limit + 1; index += 1) {
      await seedSession(db, {
        organizationId: lane.ctx.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionKey: `ph:db-wc-truncate-${String(index)}`,
        startedAt: new Date(Date.UTC(2026, 6, 30, 9 + index)),
      });
    }

    const result = await repo.listSessions({ projectId: lane.projectId, lane: "real" }, { limit });

    expect(result.sessions).toHaveLength(limit);
    expect(result.truncated).toBe(true);
  });

  it("should return only exact matches when filtering by identity_email_domain", async () => {
    const lane = await setUp(db, "domain-exact");
    const repo = createSessionsRepo(db, lane.ctx);
    const domains = ["acme.example", "acme.example.co", "ACME.EXAMPLE", "notacme.example"];

    for (const [index, identityEmailDomain] of domains.entries()) {
      await seedSession(db, {
        organizationId: lane.ctx.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionKey: `ph:db-wc-domain-${String(index)}`,
        identityEmailDomain,
      });
    }

    const result = await repo.listSessions(
      { projectId: lane.projectId, lane: "real", identityEmailDomain: "acme.example" },
      { limit: 50 },
    );

    expect(result.sessions.map((session) => session.identityEmailDomain)).toEqual(["acme.example"]);
  });

  it("should return only exact matches when filtering by entry_url_path and omit null rows", async () => {
    const lane = await setUp(db, "entry-exact");
    const repo = createSessionsRepo(db, lane.ctx);
    const paths: (string | null)[] = ["/pricing", "/pricing/enterprise", null];

    for (const [index, entryUrlPath] of paths.entries()) {
      await seedSession(db, {
        organizationId: lane.ctx.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionKey: `ph:db-wc-entry-${String(index)}`,
        entryUrlPath,
      });
    }

    const result = await repo.listSessions(
      { projectId: lane.projectId, lane: "real", entryUrlPath: "/pricing" },
      { limit: 50 },
    );

    expect(result.sessions.map((session) => session.entryUrlPath)).toEqual(["/pricing"]);
  });

  it("should no longer expose listGroupableSessions or listSessionsForDomain", async () => {
    const lane = await setUp(db, "deleted-methods");
    const surface = createSessionsRepo(db, lane.ctx) as unknown as Record<string, unknown>;

    expect(LANE_IS_REQUIRED).toBe(false);
    expect(surface.listGroupableSessions).toBeUndefined();
    expect(surface.listSessionsForDomain).toBeUndefined();
    expect(typeof surface.listSessions).toBe("function");
  });
});
