// Wave 0b (RED) — lane L3, fixture seed prefix `db-`.
// ADD tasks/session-source-posthog-adapter/add.md §9 items 79–82 — FR-20 / D7 / D1.
//
// File placement note: the ADD lists these under `cross-tenant.test.ts`; this
// lane's suites live under `__tests__/repositories/` so one command runs them
// all. Same file, same four items.
//
// The full matrix, on real SQL:
//   79 — org B READS nothing of org A's connections, sessions, events, runs.
//   80 — org B MUTATES nothing of org A's, and gets `null`/no rows rather than
//        a silent success that leaves the row changed.
//   81 — org A's NON-OWNER teammate CAN read all of it. This is the flagship
//        failure class (D1): the feature works for the person who set it up
//        and is silently invisible to everyone else on their team. It is
//        asserted here, never assumed.
//   82 — a client-supplied FOREIGN project id widens nothing, through any
//        repository or service.
//
// Every read-back goes through the public repository/service contract. Reading
// rows directly would prove nothing about scoping, which is the entire subject.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { CredentialKeyResolution, TenantContext } from "@growthmind/shared";

import { createEventsRepo } from "../../src/repositories/events.repo";
import { createPollRunsRepo } from "../../src/repositories/poll-runs.repo";
import { createProjectConnectionsRepo } from "../../src/repositories/project-connections.repo";
import { createProjectsRepo } from "../../src/repositories/projects.repo";
import { createSessionsRepo, type SessionUpsertRow } from "../../src/repositories/sessions.repo";
import {
  createConnectionsService,
  type ConnectionsServiceDeps,
} from "../../src/services/connections.service";
import { createEventsCounterService } from "../../src/services/events-counter.service";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, seedEvent, seedPollRun, seedSession } from "../helpers/db-lane-fixtures";
import {
  makeTenantContext,
  seedConnection,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "../helpers/fixtures";

const NAMES = laneNames("xt");

const SESSION_KEY_A = "ph:db-xt-org-a-session";
const SOURCE_EVENT_ID_A = "db-xt-org-a-event-0001";

/** A 32-byte all-zero key. Not a secret and cannot protect anything — the
 * services under test here never encrypt, they only read. */
const FAKE_CREDENTIAL_KEY: CredentialKeyResolution = {
  ok: true,
  key: { bytes: new Uint8Array(32) },
};

/** Deps whose source factory THROWS: `getState` must answer from persisted
 * state alone, so any call here is itself the bug. */
const READ_ONLY_DEPS: ConnectionsServiceDeps = {
  createSource: () => {
    throw new Error("getState must never construct a source");
  },
  credentialKey: FAKE_CREDENTIAL_KEY,
  now: () => new Date("2026-07-30T12:00:00.000Z"),
};

interface Fixture {
  ownerCtx: TenantContext;
  teammateCtx: TenantContext;
  foreignCtx: TenantContext;
  projectId: string;
  connectionId: string;
  sessionId: string;
  foreignProjectId: string;
}

/**
 * Org A (owner + a NON-OWNER teammate, both real `member` rows) with a
 * connection, a session, an event, and a completed poll run; plus org B with
 * its own project, whose owner is the foreign actor.
 */
async function seedMatrix(db: TestDb, label: string): Promise<Fixture> {
  const orgA = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(`${label}-a`),
    userName: NAMES.userName(`${label}-a-owner`),
    email: NAMES.email(`${label}-a-owner`),
  });
  const orgB = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(`${label}-b`),
    userName: NAMES.userName(`${label}-b-owner`),
    email: NAMES.email(`${label}-b-owner`),
  });

  const teammate = await seedUser(db, {
    name: NAMES.userName(`${label}-a-teammate`),
    email: NAMES.email(`${label}-a-teammate`),
  });
  await seedMember(db, {
    organizationId: orgA.organizationId,
    userId: teammate.id,
    role: "member",
  });

  const projectA = await seedProject(db, {
    organizationId: orgA.organizationId,
    name: NAMES.projectName(`${label}-a`),
  });
  const projectB = await seedProject(db, {
    organizationId: orgB.organizationId,
    name: NAMES.projectName(`${label}-b`),
  });
  const connectionA = await seedConnection(db, {
    organizationId: orgA.organizationId,
    projectId: projectA.id,
    watermarkAt: new Date("2026-07-30T11:00:00.000Z"),
  });
  const sessionA = await seedSession(db, {
    organizationId: orgA.organizationId,
    projectId: projectA.id,
    connectionId: connectionA.id,
    sessionKey: SESSION_KEY_A,
    identityEmailDomain: "acme.example",
    identityResolution: "resolved",
  });
  await seedEvent(db, {
    organizationId: orgA.organizationId,
    projectId: projectA.id,
    connectionId: connectionA.id,
    sessionId: sessionA.id,
    sourceEventId: SOURCE_EVENT_ID_A,
  });
  await seedPollRun(db, {
    organizationId: orgA.organizationId,
    projectId: projectA.id,
    connectionId: connectionA.id,
  });

  return {
    ownerCtx: orgA.ctx,
    teammateCtx: makeTenantContext({
      userId: teammate.id,
      organizationId: orgA.organizationId,
      organizationName: orgA.organizationName,
      role: "member",
    }),
    foreignCtx: orgB.ctx,
    projectId: projectA.id,
    connectionId: connectionA.id,
    sessionId: sessionA.id,
    foreignProjectId: projectB.id,
  };
}

describe("cross-tenant boundary on the O-003 tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- item 79 -------------------------------------------------------------
  it("returns nothing to org B for org A's connections, sessions, events, and poll runs", async () => {
    const fx = await seedMatrix(db, "read");

    expect(
      await createProjectConnectionsRepo(db, fx.foreignCtx).getActiveForProject(fx.projectId),
    ).toBeNull();

    const sessionsB = createSessionsRepo(db, fx.foreignCtx);
    expect(await sessionsB.listForProject(fx.projectId, { limit: 50 })).toEqual([]);
    expect(await sessionsB.findByKey(fx.projectId, SESSION_KEY_A)).toBeNull();

    const eventsB = createEventsRepo(db, fx.foreignCtx);
    expect(await eventsB.listForProject(fx.projectId, { limit: 50 })).toEqual([]);
    expect(await eventsB.listForSession(fx.sessionId, { limit: 50 })).toEqual([]);

    const runsB = createPollRunsRepo(db, fx.foreignCtx);
    expect(await runsB.latestCompletedFor(fx.connectionId)).toBeNull();

    // An aggregation is hand-written SQL, so it carries the org filter itself
    // rather than inheriting one — zeros, never org A's totals.
    const aggregate = await runsB.aggregateFor(fx.connectionId);
    expect(aggregate.runsCompleted).toBe(0);
    expect(aggregate.totalEventsReceived).toBe(0);
    expect(aggregate.totalEventsPersisted).toBe(0);
    expect(aggregate.lastSuccessfulFinishedAt).toBeNull();
  });

  // --- item 80 (connections) ----------------------------------------------
  it("mutates none of org A's connection state from org B, and leaves the row untouched", async () => {
    const fx = await seedMatrix(db, "mutate-connection");
    const repoB = createProjectConnectionsRepo(db, fx.foreignCtx);

    expect(await repoB.deactivate(fx.connectionId)).toBeNull();
    expect(
      await repoB.recordHealth(fx.connectionId, {
        health: "failing",
        reasonCode: "invalid_credentials",
        reasonMessage: "written by a foreign organization",
        checkedAt: new Date("2026-07-30T12:00:00.000Z"),
      }),
    ).toBeNull();
    expect(
      await repoB.advanceWatermark(fx.connectionId, {
        watermarkAt: new Date("2026-07-30T23:00:00.000Z"),
        backfillBefore: "2026-07-30T22:00:00.000+00:00",
      }),
    ).toBeNull();

    const served = await createProjectConnectionsRepo(db, fx.ownerCtx).getActiveForProject(
      fx.projectId,
    );
    expect(served?.isActive).toBe(true);
    expect(served?.health).toBe("healthy");
    expect(served?.watermarkAt?.getTime()).toBe(new Date("2026-07-30T11:00:00.000Z").getTime());
    expect(served?.backfillBefore).toBeNull();
  });

  // --- item 80 (sessions) --------------------------------------------------
  it("cannot overwrite org A's session through an upsert issued by org B", async () => {
    const fx = await seedMatrix(db, "mutate-session");

    const hostileRow: SessionUpsertRow = {
      projectId: fx.projectId,
      connectionId: fx.connectionId,
      sessionKey: SESSION_KEY_A,
      identityKey: "db-xt-hostile",
      identityEmailDomain: "attacker.example",
      identityResolution: "resolved",
      userAgent: "HeadlessChrome/125.0.0.0",
      entryUrlPath: "/hostile",
      startedAt: new Date("2026-07-30T00:00:00.000Z"),
      lastEventAt: new Date("2026-07-30T23:59:00.000Z"),
      origin: "real",
      exclusionReason: "automation_headless",
      internalDomainAtStamp: "attacker.example",
      exclusionRuleSetVersion: 1,
      groupingVersion: 1,
    };

    // Either a refusal or zero affected rows is acceptable. A SILENT SUCCESS
    // that edits org A's row is not, and that is what the read-back proves.
    let caught: unknown;
    let returned: unknown;
    try {
      returned = await createSessionsRepo(db, fx.foreignCtx).upsertMany([hostileRow]);
    } catch (error) {
      caught = error;
    }
    if (caught === undefined) {
      expect(returned).toEqual([]);
    }

    const served = await createSessionsRepo(db, fx.ownerCtx).findByKey(fx.projectId, SESSION_KEY_A);
    expect(served?.organizationId).toBe(fx.ownerCtx.organizationId);
    expect(served?.identityEmailDomain).toBe("acme.example");
    expect(served?.exclusionReason).toBe("none");
    expect(served?.entryUrlPath).not.toBe("/hostile");
  });

  // --- item 81 -------------------------------------------------------------
  it("lets org A's non-owner teammate read the connection, sessions, events, and counter", async () => {
    const fx = await seedMatrix(db, "teammate");
    expect(fx.teammateCtx.role).toBe("member");
    expect(fx.teammateCtx.userId).not.toBe(fx.ownerCtx.userId);

    const connection = await createProjectConnectionsRepo(db, fx.teammateCtx).getActiveForProject(
      fx.projectId,
    );
    expect(connection?.id).toBe(fx.connectionId);
    expect(connection?.health).toBe("healthy");

    const sessions = await createSessionsRepo(db, fx.teammateCtx).listForProject(fx.projectId, {
      limit: 50,
    });
    expect(sessions.map((session) => session.sessionKey)).toContain(SESSION_KEY_A);

    const events = await createEventsRepo(db, fx.teammateCtx).listForProject(fx.projectId, {
      limit: 50,
    });
    expect(events.map((event) => event.sourceEventId)).toContain(SOURCE_EVENT_ID_A);

    const runs = await createPollRunsRepo(db, fx.teammateCtx).latestCompletedFor(fx.connectionId);
    expect(runs).not.toBeNull();

    // The counter is the onboarding surface a teammate lands on. It is a
    // hand-written aggregation, so it is the likeliest place for a
    // creator-only narrowing to hide.
    const counter = await createEventsCounterService(db, fx.teammateCtx).read(fx.projectId);
    expect(counter.state.status).not.toBe("not_connected");
    expect(counter.totalReceived).toBeGreaterThan(0);

    const state = await createConnectionsService(db, fx.teammateCtx, READ_ONLY_DEPS).getState(
      fx.projectId,
    );
    expect(state.status).not.toBe("not_connected");
  });

  // --- item 82 -------------------------------------------------------------
  it("widens nothing when a foreign project id is supplied to a repository", async () => {
    const fx = await seedMatrix(db, "foreign-project");

    // Org B naming org A's project — the client-supplied id path.
    expect(await createProjectsRepo(db, fx.foreignCtx).findById(fx.projectId)).toBeNull();
    expect(
      await createProjectConnectionsRepo(db, fx.foreignCtx).getActiveForProject(fx.projectId),
    ).toBeNull();
    expect(
      await createSessionsRepo(db, fx.foreignCtx).listForProject(fx.projectId, { limit: 50 }),
    ).toEqual([]);
    expect(
      await createEventsRepo(db, fx.foreignCtx).listForProject(fx.projectId, { limit: 50 }),
    ).toEqual([]);

    // And the mirror direction: org A naming org B's project sees nothing
    // either, so the boundary is not one-sided.
    expect(await createProjectsRepo(db, fx.ownerCtx).findById(fx.foreignProjectId)).toBeNull();
    expect(
      await createSessionsRepo(db, fx.ownerCtx).listForProject(fx.foreignProjectId, { limit: 50 }),
    ).toEqual([]);
  });

  // --- item 82 (services) --------------------------------------------------
  it("widens nothing when a foreign project id is supplied to a service", async () => {
    const fx = await seedMatrix(db, "foreign-project-service");

    const state = await createConnectionsService(db, fx.foreignCtx, READ_ONLY_DEPS).getState(
      fx.projectId,
    );
    // `not_connected` is the honest answer for an org with no attachment on a
    // project it cannot see — never org A's connection summary.
    expect(state.status).toBe("not_connected");
    expect(JSON.stringify(state)).not.toContain(fx.connectionId);

    const counter = await createEventsCounterService(db, fx.foreignCtx).read(fx.projectId);
    expect(counter.state.status).toBe("not_connected");
    expect(counter.totalReceived).toBe(0);
    expect(counter.kept).toBe(0);
    expect(counter.droppedUnreadable).toBe(0);
  });
});
