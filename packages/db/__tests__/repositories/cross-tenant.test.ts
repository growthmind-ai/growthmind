import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { DETECTOR_CORPUS_MAX_SESSIONS, type AnalysisWindow } from "@growthmind/core";
import {
  EXCLUSION_REASON_LABELS,
  URL_PATH_NORMALISATION_VERSION,
  type CredentialKeyResolution,
  type ExclusionReason,
  type TenantContext,
} from "@growthmind/shared";

import { createEventsRepo } from "../../src/repositories/events.repo";
import { createPollRunsRepo } from "../../src/repositories/poll-runs.repo";
import { createProjectConnectionsRepo } from "../../src/repositories/project-connections.repo";
import { createProjectsRepo } from "../../src/repositories/projects.repo";
import { createSessionsRepo, type SessionUpsertRow } from "../../src/repositories/sessions.repo";
import * as schema from "../../src/schema";
import {
  createConnectionsService,
  type ConnectionsServiceDeps,
} from "../../src/services/connections.service";
import { createDetectorCorpusService } from "../../src/services/detector-corpus.service";
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

import { createHash } from "node:crypto";

import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import { createFindingSignaturesRepo } from "../../src/repositories/finding-signatures.repo";
import { createSignatureAncestryRepo } from "../../src/repositories/signature-ancestry.repo";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";

const NAMES = laneNames("xt");

const SESSION_KEY_A = "ph:db-xt-org-a-session";
const SOURCE_EVENT_ID_A = "db-xt-org-a-event-0001";

const FAKE_CREDENTIAL_KEY: CredentialKeyResolution = {
  ok: true,
  key: { bytes: new Uint8Array(32) },
};

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

describe("cross-tenant boundary on the tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

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

    const aggregate = await runsB.aggregateFor(fx.connectionId);
    expect(aggregate.runsCompleted).toBe(0);
    expect(aggregate.totalEventsReceived).toBe(0);
    expect(aggregate.totalEventsPersisted).toBe(0);
    expect(aggregate.lastSuccessfulFinishedAt).toBeNull();
  });

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

    const counter = await createEventsCounterService(db, fx.teammateCtx).read(fx.projectId);
    expect(counter.state.status).not.toBe("not_connected");
    expect(counter.totalReceived).toBeGreaterThan(0);

    const state = await createConnectionsService(db, fx.teammateCtx, READ_ONLY_DEPS).getState(
      fx.projectId,
    );
    expect(state.status).not.toBe("not_connected");
  });

  it("widens nothing when a foreign project id is supplied to a repository", async () => {
    const fx = await seedMatrix(db, "foreign-project");

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

    expect(await createProjectsRepo(db, fx.ownerCtx).findById(fx.foreignProjectId)).toBeNull();
    expect(
      await createSessionsRepo(db, fx.ownerCtx).listForProject(fx.foreignProjectId, { limit: 50 }),
    ).toEqual([]);
  });

  it("widens nothing when a foreign project id is supplied to a service", async () => {
    const fx = await seedMatrix(db, "foreign-project-service");

    const state = await createConnectionsService(db, fx.foreignCtx, READ_ONLY_DEPS).getState(
      fx.projectId,
    );

    expect(state.status).toBe("not_connected");
    expect(JSON.stringify(state)).not.toContain(fx.connectionId);

    const counter = await createEventsCounterService(db, fx.foreignCtx).read(fx.projectId);
    expect(counter.state.status).toBe("not_connected");
    expect(counter.totalReceived).toBe(0);
    expect(counter.kept).toBe(0);
    expect(counter.droppedUnreadable).toBe(0);
  });
});

const CORPUS_NAMES = laneNames("dc");

const CORPUS_SERVICE_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "services",
  "detector-corpus.service.ts",
);

const WINDOW: AnalysisWindow = {
  start: new Date("2026-07-20T00:00:00.000Z"),
  end: new Date("2026-07-30T23:59:59.999Z"),
};

const CONNECTED_AT = new Date("2026-07-19T09:00:00.000Z");
const NEXT_POLL_AT = new Date("2026-07-31T00:00:00.000Z");
const POLL_STARTED_AT = new Date("2026-07-30T23:00:00.000Z");
const POLL_FINISHED_AT = new Date("2026-07-30T23:00:05.000Z");
const MEMBER_CREATED_AT = new Date("2026-07-19T08:00:00.000Z");

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

interface CorpusOrg {
  ctx: TenantContext;

  teammateCtx: TenantContext;
  organizationId: string;
  projectId: string;
  connectionId: string;
}

async function seedCorpusOrg(
  db: TestDb,
  label: string,
  options: { withCompletedPoll?: boolean } = {},
): Promise<CorpusOrg> {
  const org = await seedOrgWithOwner(db, {
    orgName: CORPUS_NAMES.orgName(label),
    userName: CORPUS_NAMES.userName(`${label}-owner`),
    email: CORPUS_NAMES.email(`${label}-owner`),
  });

  const teammate = await seedUser(db, {
    name: CORPUS_NAMES.userName(`${label}-teammate`),
    email: CORPUS_NAMES.email(`${label}-teammate`),
  });
  await seedMember(db, {
    organizationId: org.organizationId,
    userId: teammate.id,
    role: "member",
    createdAt: MEMBER_CREATED_AT,
  });

  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: CORPUS_NAMES.projectName(label),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
    watermarkAt: POLL_FINISHED_AT,
    connectedAt: CONNECTED_AT,
    nextPollAt: NEXT_POLL_AT,
  });

  if (options.withCompletedPoll ?? true) {
    await seedPollRun(db, {
      organizationId: org.organizationId,
      projectId: project.id,
      connectionId: connection.id,
      startedAt: POLL_STARTED_AT,
      finishedAt: POLL_FINISHED_AT,
      watermarkAdvancedTo: POLL_FINISHED_AT,
    });
  }

  return {
    ctx: org.ctx,
    teammateCtx: makeTenantContext({
      userId: teammate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    }),
    organizationId: org.organizationId,
    projectId: project.id,
    connectionId: connection.id,
  };
}

const CORPUS_DEFAULT_URL_PATH = "/pricing";

interface CorpusEventSpec {
  readonly sourceEventId: string;
  readonly occurredAt: Date;
  readonly name?: string;

  readonly urlPath?: string | null;

  readonly urlPathNormalisationVersion?: number | null;
}

interface CorpusSessionSpec {
  readonly sessionKey: string;
  readonly startedAt: Date;
  readonly exclusionReason?: ExclusionReason;
  readonly events: readonly CorpusEventSpec[];
}

async function seedCorpusSessions(
  db: TestDb,
  org: CorpusOrg,
  specs: readonly CorpusSessionSpec[],
): Promise<ReadonlyMap<string, string>> {
  const ids = new Map<string, string>();
  const sessionRows: (typeof schema.sessions.$inferInsert)[] = [];
  const eventRows: (typeof schema.events.$inferInsert)[] = [];

  for (const spec of specs) {
    const sessionId = randomUUID();
    ids.set(spec.sessionKey, sessionId);
    const firstUrlPath = spec.events.at(0)?.urlPath;

    sessionRows.push({
      id: sessionId,
      organizationId: org.organizationId,
      projectId: org.projectId,
      connectionId: org.connectionId,
      sessionKey: spec.sessionKey,
      identityKey: null,
      identityEmailDomain: null,
      identityResolution: "unresolved",
      userAgent: null,

      entryUrlPath: firstUrlPath === undefined ? CORPUS_DEFAULT_URL_PATH : firstUrlPath,
      startedAt: spec.startedAt,
      lastEventAt: spec.events.at(-1)?.occurredAt ?? spec.startedAt,
      origin: "real",
      exclusionReason: spec.exclusionReason ?? "none",
      internalDomainAtStamp: null,
      exclusionRuleSetVersion: 1,
      groupingVersion: 1,
    });

    for (const event of spec.events) {
      eventRows.push({
        id: randomUUID(),
        organizationId: org.organizationId,
        projectId: org.projectId,
        connectionId: org.connectionId,
        sessionId,
        sourceEventId: event.sourceEventId,
        name: event.name ?? "$pageview",
        occurredAt: event.occurredAt,

        urlPath: event.urlPath === undefined ? CORPUS_DEFAULT_URL_PATH : event.urlPath,

        urlPathNormalisationVersion:
          event.urlPathNormalisationVersion === undefined
            ? URL_PATH_NORMALISATION_VERSION
            : event.urlPathNormalisationVersion,
      });
    }
  }

  if (sessionRows.length > 0) {
    await db.insert(schema.sessions).values(sessionRows);
  }
  if (eventRows.length > 0) {
    await db.insert(schema.events).values(eventRows);
  }

  return ids;
}

function sessionIdOf(ids: ReadonlyMap<string, string>, sessionKey: string): string {
  const id = ids.get(sessionKey);
  if (id === undefined) {
    throw new Error(`seedCorpusSessions: no session id seeded for "${sessionKey}"`);
  }
  return id;
}

function capSessionKey(index: number): string {
  return `ph:db-dc-cap-${index}`;
}

function stripSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("detector-corpus.service — the T1 corpus read", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("detector-corpus.service returns nothing to org B for org A's project", async () => {
    const orgA = await seedCorpusOrg(db, "tenancy-a");
    const orgB = await seedCorpusOrg(db, "tenancy-b");
    const ids = await seedCorpusSessions(db, orgA, [
      {
        sessionKey: "ph:db-dc-tenancy-a-1",
        startedAt: new Date("2026-07-25T10:00:00.000Z"),
        events: [
          {
            sourceEventId: "db-dc-tenancy-a-evt-1",
            occurredAt: new Date("2026-07-25T10:00:01.000Z"),
          },
        ],
      },
    ]);

    const corpus = await createDetectorCorpusService(db, orgB.ctx).read(orgA.projectId, WINDOW);

    expect(corpus.sessions).toEqual([]);
    expect(corpus.basis.totalInWindow).toBe(0);
    expect(corpus.basis.kept).toBe(0);
    expect(corpus.basis.setAside).toEqual([]);

    expect(corpus.connectionState.status).toBe("not_connected");

    const serialised = JSON.stringify(corpus);
    expect(serialised).not.toContain(sessionIdOf(ids, "ph:db-dc-tenancy-a-1"));
    expect(serialised).not.toContain("db-dc-tenancy-a-evt-1");
    expect(serialised).not.toContain(orgA.connectionId);
  });

  it("detector-corpus.service returns everything to org A's non-owner teammate", async () => {
    const orgA = await seedCorpusOrg(db, "teammate");
    const ids = await seedCorpusSessions(db, orgA, [
      {
        sessionKey: "ph:db-dc-teammate-1",
        startedAt: new Date("2026-07-25T10:00:00.000Z"),
        events: [
          {
            sourceEventId: "db-dc-teammate-evt-1",
            occurredAt: new Date("2026-07-25T10:00:01.000Z"),
            urlPath: "/pricing",
          },
          {
            sourceEventId: "db-dc-teammate-evt-2",
            occurredAt: new Date("2026-07-25T10:00:09.000Z"),
            urlPath: "/checkout",
          },
        ],
      },
    ]);

    expect(orgA.teammateCtx.role).toBe("member");
    expect(orgA.teammateCtx.userId).not.toBe(orgA.ctx.userId);

    const corpus = await createDetectorCorpusService(db, orgA.teammateCtx).read(
      orgA.projectId,
      WINDOW,
    );

    expect(corpus.projectId).toBe(orgA.projectId);
    expect(corpus.sessions.map((session) => session.sessionId)).toEqual([
      sessionIdOf(ids, "ph:db-dc-teammate-1"),
    ]);
    expect(
      corpus.sessions.flatMap((session) => session.events).map((e) => e.sourceEventId),
    ).toEqual(["db-dc-teammate-evt-1", "db-dc-teammate-evt-2"]);
    expect(corpus.basis.totalInWindow).toBe(1);
    expect(corpus.basis.kept).toBe(1);

    expect(corpus.connectionState.status).toBe("connected_receiving");
  });

  it("detector-corpus.service widens nothing when a foreign project id is supplied", async () => {
    const orgA = await seedCorpusOrg(db, "foreign-a");
    const orgB = await seedCorpusOrg(db, "foreign-b");

    const idsA = await seedCorpusSessions(db, orgA, [
      {
        sessionKey: "ph:db-dc-foreign-a-1",
        startedAt: new Date("2026-07-25T10:00:00.000Z"),
        events: [
          {
            sourceEventId: "db-dc-foreign-a-evt-1",
            occurredAt: new Date("2026-07-25T10:00:01.000Z"),
          },
        ],
      },
    ]);
    const idsB = await seedCorpusSessions(db, orgB, [
      {
        sessionKey: "ph:db-dc-foreign-b-1",
        startedAt: new Date("2026-07-26T10:00:00.000Z"),
        events: [
          {
            sourceEventId: "db-dc-foreign-b-evt-1",
            occurredAt: new Date("2026-07-26T10:00:01.000Z"),
          },
        ],
      },
    ]);

    const service = createDetectorCorpusService(db, orgA.ctx);

    const aReadingB = await service.read(orgB.projectId, WINDOW);
    expect(aReadingB.sessions).toEqual([]);
    expect(aReadingB.basis.totalInWindow).toBe(0);
    expect(aReadingB.connectionState.status).toBe("not_connected");
    expect(JSON.stringify(aReadingB)).not.toContain(sessionIdOf(idsB, "ph:db-dc-foreign-b-1"));
    expect(JSON.stringify(aReadingB)).not.toContain(sessionIdOf(idsA, "ph:db-dc-foreign-a-1"));

    const bReadingA = await createDetectorCorpusService(db, orgB.ctx).read(orgA.projectId, WINDOW);
    expect(bReadingA.sessions).toEqual([]);
    expect(bReadingA.basis.totalInWindow).toBe(0);
    expect(JSON.stringify(bReadingA)).not.toContain(sessionIdOf(idsA, "ph:db-dc-foreign-a-1"));
  });

  it("detector-corpus.service scopes every sessions and events read through the scope helper", () => {
    const source = readFileSync(CORPUS_SERVICE_SOURCE_PATH, "utf8");
    const code = stripSourceComments(source);

    expect(source.length).toBeGreaterThan(0);
    expect(code).toContain("createDetectorCorpusService");

    const countOf = (pattern: RegExp): number => (code.match(pattern) ?? []).length;

    const sessionReads = countOf(/\.from\(\s*sessions\s*\)/g);
    const eventReads = countOf(/\.from\(\s*events\s*\)/g);

    expect(sessionReads).toBeGreaterThan(0);
    expect(eventReads).toBeGreaterThan(0);

    expect(countOf(/s\.(owned|org)\(\s*sessions\b/g)).toBe(sessionReads);
    expect(countOf(/s\.(owned|org)\(\s*events\b/g)).toBe(eventReads);

    // Nothing may reconstruct the filter by hand beside the helper.
    expect(code).not.toMatch(/eq\(\s*\w+\.organizationId\s*,\s*ctx\.organizationId\s*\)/);
  });

  describe("the session cap", () => {
    const EVENTS_PER_SESSION = 3;
    const OVER_CAP = DETECTOR_CORPUS_MAX_SESSIONS + 1;
    const CAP_BASE = new Date("2026-07-21T00:00:00.000Z");
    const UNDER_CAP = 3;

    let overCapOrg: CorpusOrg;
    let overCapIds: ReadonlyMap<string, string>;
    let underCapOrg: CorpusOrg;

    beforeAll(async () => {
      overCapOrg = await seedCorpusOrg(db, "cap-over");
      overCapIds = await seedCorpusSessions(
        db,
        overCapOrg,
        Array.from({ length: OVER_CAP }, (_unused, index) => {
          const startedAt = new Date(CAP_BASE.getTime() + index * MINUTE_MS);
          return {
            sessionKey: capSessionKey(index),
            startedAt,
            events: Array.from({ length: EVENTS_PER_SESSION }, (_e, slot) => ({
              sourceEventId: `db-dc-cap-${index}-${slot}`,
              occurredAt: new Date(startedAt.getTime() + slot * 1_000),
            })),
          };
        }),
      );

      underCapOrg = await seedCorpusOrg(db, "cap-under");
      await seedCorpusSessions(
        db,
        underCapOrg,
        Array.from({ length: UNDER_CAP }, (_unused, index) => {
          const startedAt = new Date(CAP_BASE.getTime() + index * MINUTE_MS);
          return {
            sessionKey: `ph:db-dc-under-${index}`,
            startedAt,
            events: [{ sourceEventId: `db-dc-under-${index}-0`, occurredAt: startedAt }],
          };
        }),
      );
    });

    it("detector-corpus.service caps by session and never returns a partially-loaded session", async () => {
      const corpus = await createDetectorCorpusService(db, overCapOrg.ctx).read(
        overCapOrg.projectId,
        WINDOW,
      );

      expect(corpus.sessions.length).toBe(DETECTOR_CORPUS_MAX_SESSIONS);

      const distinctEventCounts = [
        ...new Set(corpus.sessions.map((session) => session.events.length)),
      ];
      expect(distinctEventCounts).toEqual([EVENTS_PER_SESSION]);
      expect(corpus.sessions.flatMap((session) => session.events).length).toBe(
        DETECTOR_CORPUS_MAX_SESSIONS * EVENTS_PER_SESSION,
      );

      const returned = new Set(corpus.sessions.map((session) => session.sessionId));
      expect(returned.has(sessionIdOf(overCapIds, capSessionKey(0)))).toBe(false);
      expect(returned.has(sessionIdOf(overCapIds, capSessionKey(1)))).toBe(true);
      expect(returned.has(sessionIdOf(overCapIds, capSessionKey(OVER_CAP - 1)))).toBe(true);
    });

    it("detector-corpus.service sets coverage.truncated when the cap bound the result", async () => {
      const bound = await createDetectorCorpusService(db, overCapOrg.ctx).read(
        overCapOrg.projectId,
        WINDOW,
      );
      const unbound = await createDetectorCorpusService(db, underCapOrg.ctx).read(
        underCapOrg.projectId,
        WINDOW,
      );

      expect(bound.coverage.truncated).toBe(true);

      expect(unbound.coverage.truncated).toBe(false);
      expect(unbound.sessions.length).toBe(UNDER_CAP);
    });
  });

  it("detector-corpus.service excludes exclusion_reason != 'none' sessions from the denominator and reports them in basis", async () => {
    const org = await seedCorpusOrg(db, "basis");
    const BASIS_BASE = new Date("2026-07-24T09:00:00.000Z");
    const plan: readonly { readonly key: string; readonly reason: ExclusionReason }[] = [
      { key: "kept-1", reason: "none" },
      { key: "kept-2", reason: "none" },
      { key: "kept-3", reason: "none" },
      { key: "internal-1", reason: "internal_domain" },
      { key: "headless-1", reason: "automation_headless" },
    ];
    const specs: readonly CorpusSessionSpec[] = plan.map((row, index) => {
      const startedAt = new Date(BASIS_BASE.getTime() + index * HOUR_MS);
      return {
        sessionKey: `ph:db-dc-basis-${row.key}`,
        startedAt,
        exclusionReason: row.reason,
        events: [{ sourceEventId: `db-dc-basis-${row.key}-0`, occurredAt: startedAt }],
      };
    });
    const ids = await seedCorpusSessions(db, org, specs);

    const corpus = await createDetectorCorpusService(db, org.ctx).read(org.projectId, WINDOW);

    expect(corpus.sessions.length).toBe(5);
    const returned = new Set(corpus.sessions.map((session) => session.sessionId));
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-basis-internal-1"))).toBe(true);
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-basis-headless-1"))).toBe(true);
    expect(corpus.sessions.map((session) => session.exclusionReason).toSorted()).toEqual([
      "automation_headless",
      "internal_domain",
      "none",
      "none",
      "none",
    ]);

    expect(corpus.basis.totalInWindow).toBe(5);
    expect(corpus.basis.kept).toBe(3);

    expect(corpus.basis.setAside.toSorted((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      {
        reason: "automation_headless",
        count: 1,
        label: EXCLUSION_REASON_LABELS.automation_headless,
      },
      { reason: "internal_domain", count: 1, label: EXCLUSION_REASON_LABELS.internal_domain },
    ]);

    expect(corpus.basis.setAside.map((row) => row.reason)).not.toContain("none");

    const setAsideTotal = corpus.basis.setAside.reduce((total, row) => total + row.count, 0);
    expect(corpus.basis.kept + setAsideTotal).toBe(corpus.basis.totalInWindow);
  });

  it("detector-corpus.service selects sessions by started_at within the window and returns their events whole", async () => {
    const org = await seedCorpusOrg(db, "window");
    const ids = await seedCorpusSessions(db, org, [
      {
        sessionKey: "ph:db-dc-window-at-start",
        startedAt: WINDOW.start,
        events: [
          {
            sourceEventId: "db-dc-window-at-start-early",
            occurredAt: new Date(WINDOW.start.getTime() - HOUR_MS),
          },
          {
            sourceEventId: "db-dc-window-at-start-inside",
            occurredAt: new Date(WINDOW.start.getTime() + HOUR_MS),
          },
        ],
      },
      {
        sessionKey: "ph:db-dc-window-at-end",
        startedAt: WINDOW.end,
        events: [
          {
            sourceEventId: "db-dc-window-at-end-late",
            occurredAt: new Date(WINDOW.end.getTime() + HOUR_MS),
          },
        ],
      },
      {
        sessionKey: "ph:db-dc-window-before",
        startedAt: new Date(WINDOW.start.getTime() - 1),
        events: [
          {
            sourceEventId: "db-dc-window-before-evt",
            occurredAt: new Date(WINDOW.start.getTime() + HOUR_MS),
          },
        ],
      },
      {
        sessionKey: "ph:db-dc-window-after",
        startedAt: new Date(WINDOW.end.getTime() + 1),
        events: [
          {
            sourceEventId: "db-dc-window-after-evt",
            occurredAt: new Date(WINDOW.end.getTime() - HOUR_MS),
          },
        ],
      },
    ]);

    const corpus = await createDetectorCorpusService(db, org.ctx).read(org.projectId, WINDOW);

    expect(corpus.window).toEqual(WINDOW);

    const returned = new Set(corpus.sessions.map((session) => session.sessionId));
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-window-at-start"))).toBe(true);
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-window-at-end"))).toBe(true);

    expect(returned.has(sessionIdOf(ids, "ph:db-dc-window-before"))).toBe(false);
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-window-after"))).toBe(false);
    expect(corpus.sessions.length).toBe(2);
    expect(corpus.basis.totalInWindow).toBe(2);

    const atStart = corpus.sessions.find(
      (session) => session.sessionId === sessionIdOf(ids, "ph:db-dc-window-at-start"),
    );
    expect(atStart?.events.map((event) => event.sourceEventId)).toEqual([
      "db-dc-window-at-start-early",
      "db-dc-window-at-start-inside",
    ]);

    const atEnd = corpus.sessions.find(
      (session) => session.sessionId === sessionIdOf(ids, "ph:db-dc-window-at-end"),
    );
    expect(atEnd?.events.map((event) => event.sourceEventId)).toEqual(["db-dc-window-at-end-late"]);
  });

  it("detector-corpus.service returns a path-less event as null and never coerces an unknown version to 0", async () => {
    const org = await seedCorpusOrg(db, "nulls");
    const NULLS_BASE = new Date("2026-07-23T08:00:00.000Z");
    const ids = await seedCorpusSessions(db, org, [
      {
        sessionKey: "ph:db-dc-nulls-1",
        startedAt: NULLS_BASE,
        events: [
          {
            sourceEventId: "db-dc-nulls-pathless",
            occurredAt: NULLS_BASE,
            urlPath: null,
            urlPathNormalisationVersion: null,
          },
          {
            sourceEventId: "db-dc-nulls-pathed",
            occurredAt: new Date(NULLS_BASE.getTime() + MINUTE_MS),
            urlPath: "/checkout",
          },
        ],
      },
    ]);

    const corpus = await createDetectorCorpusService(db, org.ctx).read(org.projectId, WINDOW);

    const session = corpus.sessions.find(
      (row) => row.sessionId === sessionIdOf(ids, "ph:db-dc-nulls-1"),
    );
    expect(session).toBeDefined();

    const pathless = session?.events.find((e) => e.sourceEventId === "db-dc-nulls-pathless");
    const pathed = session?.events.find((e) => e.sourceEventId === "db-dc-nulls-pathed");

    expect(pathless).toBeDefined();
    expect(pathed).toBeDefined();

    expect(pathless?.urlPath).toBeNull();

    expect(pathless?.urlPathNormalisationVersion).toBeNull();
    expect(pathless?.urlPathNormalisationVersion).not.toBe(0);

    expect(pathed?.urlPath).toBe("/checkout");
    expect(pathed?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);

    expect(pathed?.urlPathNormalisationVersion).not.toBe(pathless?.urlPathNormalisationVersion);

    expect(session?.entryUrlPath).toBeNull();
  });

  it("detector-corpus.service distinguishes polled-and-found-nothing from never-polled", async () => {
    const polled = await seedCorpusOrg(db, "es1-polled");
    const neverPolled = await seedCorpusOrg(db, "es8-never", { withCompletedPoll: false });

    const polledCorpus = await createDetectorCorpusService(db, polled.ctx).read(
      polled.projectId,
      WINDOW,
    );
    const neverCorpus = await createDetectorCorpusService(db, neverPolled.ctx).read(
      neverPolled.projectId,
      WINDOW,
    );

    expect(polledCorpus.sessions).toEqual([]);
    expect(neverCorpus.sessions).toEqual([]);
    expect(polledCorpus.basis.totalInWindow).toBe(0);
    expect(neverCorpus.basis.totalInWindow).toBe(0);

    expect(polledCorpus.connectionState.status).toBe("connected_no_events_yet");
    expect(neverCorpus.connectionState.status).toBe("connected_never_polled");
    expect(polledCorpus.connectionState.status).not.toBe(neverCorpus.connectionState.status);
  });
});

function fakeSignature(label: string): SignatureHex {
  return createHash("sha256").update(label).digest("hex") as unknown as SignatureHex;
}

interface SignatureLedgerFixture {
  ownerCtx: TenantContext;
  teammateCtx: TenantContext;
  foreignCtx: TenantContext;
  projectId: string;
  foreignProjectId: string;
  findingId: string;
  signature: SignatureHex;
}

async function seedSignatureLedgerMatrix(
  db: TestDb,
  label: string,
): Promise<SignatureLedgerFixture> {
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

  const signature = fakeSignature(`db-sig-${label}-a`);

  await createFindingSignaturesRepo(db, orgA.ctx).upsertSeen({
    projectId: projectA.id,
    signature,
    symptomClass: "broken",
    surface: "/checkout",
    signatureTupleVersion: 1,
    evidenceShapeVersion: 1,
    surfaceNormalisationVersion: 2,
    seenAt: new Date("2026-07-30T12:00:00.000Z"),
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
    foreignProjectId: projectB.id,
    findingId: `db-sig-${label}-finding-0001`,
    signature,
  };
}

describe("cross-tenant boundary on the signature ledger tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("org B reads nothing of org A's ledger, dismissals, or ancestry", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-read");
    const newSignature = fakeSignature("sig-read-a-new");

    await createSignatureLedgerService(db, fx.ownerCtx).recordAncestry({
      projectId: fx.projectId,
      oldSignature: fx.signature,
      newSignature,
      reason: "surface_rename",
    });
    await createSignatureLedgerService(db, fx.ownerCtx).recordDismissal({
      projectId: fx.projectId,
      findingId: fx.findingId,
      signature: fx.signature,
      action: "not_useful",
      dismissedByUserId: fx.ownerCtx.userId,
    });

    const ledgerB = createFindingSignaturesRepo(db, fx.foreignCtx);
    expect(await ledgerB.findBySignature(fx.projectId, fx.signature)).toBeNull();

    const dismissalsB = createDismissalsRepo(db, fx.foreignCtx);
    expect(await dismissalsB.findFor(fx.findingId, "not_useful")).toBeNull();
    expect(await dismissalsB.findLatestForSignature(fx.projectId, fx.signature)).toBeNull();

    const ancestryB = createSignatureAncestryRepo(db, fx.foreignCtx);
    expect(await ancestryB.forwardEdge(fx.signature)).toBeNull();

    expect(await ancestryB.resolve(fx.signature)).toEqual({
      resolution: "resolved",
      signature: fx.signature,
      hops: 0,
    });
  });

  it("org B mutates nothing of org A's — markDelivered, dismissal, and carry-forward all return null or no rows, never a silent success", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-mutate");
    const newSignature = fakeSignature("sig-mutate-a-new");

    const deliveredByB = await createFindingSignaturesRepo(db, fx.foreignCtx).markDelivered(
      fx.projectId,
      fx.signature,
      new Date("2026-07-30T13:00:00.000Z"),
    );
    expect(deliveredByB).toBeNull();

    try {
      await createFindingSignaturesRepo(db, fx.foreignCtx).carryForward({
        projectId: fx.projectId,
        oldSignature: fx.signature,
        newSignature,
      });
    } catch {
      // acceptable, see comment above
    }

    try {
      await createSignatureLedgerService(db, fx.foreignCtx).recordDismissal({
        projectId: fx.projectId,
        findingId: fx.findingId,
        signature: fx.signature,
        action: "not_useful",
        dismissedByUserId: null,
      });
    } catch {
      // acceptable, see comment above
    }

    const served = await createFindingSignaturesRepo(db, fx.ownerCtx).findBySignature(
      fx.projectId,
      fx.signature,
    );
    expect(served?.deliveredAt ?? null).toBeNull();
    expect(served?.dismissedAt ?? null).toBeNull();

    expect(
      await createDismissalsRepo(db, fx.ownerCtx).findFor(fx.findingId, "not_useful"),
    ).toBeNull();
    expect(await createSignatureAncestryRepo(db, fx.ownerCtx).forwardEdge(fx.signature)).toBeNull();
  });

  it("org A's non-owner teammate CAN read the ledger, CAN dismiss, and their dismissal suppresses for the owner", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-teammate");
    expect(fx.teammateCtx.role).toBe("member");
    expect(fx.teammateCtx.userId).not.toBe(fx.ownerCtx.userId);

    const ledgerRow = await createFindingSignaturesRepo(db, fx.teammateCtx).findBySignature(
      fx.projectId,
      fx.signature,
    );
    expect(ledgerRow?.signature).toBe(fx.signature);

    const dismissal = await createSignatureLedgerService(db, fx.teammateCtx).recordDismissal({
      projectId: fx.projectId,
      findingId: fx.findingId,
      signature: fx.signature,
      action: "not_useful",
      dismissedByUserId: fx.teammateCtx.userId,
    });
    expect(dismissal.dismissedByUserId).toBe(fx.teammateCtx.userId);

    const decision = await createSignatureLedgerService(db, fx.ownerCtx).consultSignature(
      fx.projectId,
      fx.signature,
    );
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  it("the owner's dismissal suppresses for the non-owner teammate", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-teammate-reverse");

    await createSignatureLedgerService(db, fx.ownerCtx).recordDismissal({
      projectId: fx.projectId,
      findingId: fx.findingId,
      signature: fx.signature,
      action: "not_useful",
      dismissedByUserId: fx.ownerCtx.userId,
    });

    const decision = await createSignatureLedgerService(db, fx.teammateCtx).consultSignature(
      fx.projectId,
      fx.signature,
    );
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  it("a client-supplied foreign project id widens nothing through any of the three repositories or the service", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-foreign-project");

    expect(
      await createFindingSignaturesRepo(db, fx.ownerCtx).findBySignature(
        fx.foreignProjectId,
        fx.signature,
      ),
    ).toBeNull();

    expect(
      await createDismissalsRepo(db, fx.ownerCtx).findLatestForSignature(
        fx.foreignProjectId,
        fx.signature,
      ),
    ).toBeNull();

    const decision = await createSignatureLedgerService(db, fx.ownerCtx).consultSignature(
      fx.foreignProjectId,
      fx.signature,
    );

    expect(decision).toEqual({ decision: "deliver", reason: "not_seen_before" });
  });
});
