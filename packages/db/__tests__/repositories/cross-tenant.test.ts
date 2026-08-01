// Wave 0b (red), lane L3, fixture seed prefix `db-`. Add
// tasks/session-source-posthog-adapter/add.md items 79–82, / /.
//
// File placement note: the add lists these under `cross-tenant.test.ts`; this lane's
// suites live under `__tests__/repositories/` so one command runs them all. Same file,
// same four items.
//
// The full matrix, on real SQL: 79. Org b reads nothing of org A's connections,
// sessions, events, runs. 80, org b mutates nothing of org A's, and gets `null`/no rows
// rather than
//  a silent success that leaves the row changed.
// 81, org A's non-owner teammate can read all of it. This is the flagship
//  failure class: the feature works for the person who set it up
//  and is silently invisible to everyone else on their team. It is
//  asserted here, never assumed.
// 82, a client-supplied foreign project id widens nothing, through any
//  repository or service.
//
// Every read-back goes through the public repository/service contract. Reading rows
// directly would prove nothing about scoping, which is the entire subject.
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

// --: the signature ledger's cross-tenant matrix New imports for the appended describe
// block at the end of this file. Kept as a separate import group (rather than merged
// into the blocks above) to minimise the merge-collision surface on this file's
// existing import lines. A concurrent sprint is also appending to this file.
import { createHash } from "node:crypto";

import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import { createFindingSignaturesRepo } from "../../src/repositories/finding-signatures.repo";
import { createSignatureAncestryRepo } from "../../src/repositories/signature-ancestry.repo";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";

const NAMES = laneNames("xt");

const SESSION_KEY_A = "ph:db-xt-org-a-session";
const SOURCE_EVENT_ID_A = "db-xt-org-a-event-0001";

/** A 32-byte all-zero key. Not a secret and cannot protect anything. The services under
 * test here never encrypt, they only read. */
const FAKE_CREDENTIAL_KEY: CredentialKeyResolution = {
  ok: true,
  key: { bytes: new Uint8Array(32) },
};

/** Deps whose source factory throws: `getState` must answer from persisted state alone,
 * so any call here is itself the bug. */
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
 * Org A (owner + a non-owner teammate, both real `member` rows) with a connection, a
 * session, an event, and a completed poll run; plus org B with its own project, whose
 * owner is the foreign actor.
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

describe("cross-tenant boundary on the tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // -- item 79
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

    // An aggregation is hand-written SQL, so it carries the org filter itself rather
    // than inheriting one. Zeros, never org A's totals.
    const aggregate = await runsB.aggregateFor(fx.connectionId);
    expect(aggregate.runsCompleted).toBe(0);
    expect(aggregate.totalEventsReceived).toBe(0);
    expect(aggregate.totalEventsPersisted).toBe(0);
    expect(aggregate.lastSuccessfulFinishedAt).toBeNull();
  });

  // -- item 80 (connections)
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

  // -- item 80 (sessions)
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

    // Either a refusal or zero affected rows is acceptable. A silent success that edits
    // org A's row is not, and that is what the read-back proves.
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

  // -- item 81
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

    // The counter is the onboarding surface a teammate lands on. It is a hand-written
    // aggregation, so it is the likeliest place for a creator-only narrowing to hide.
    const counter = await createEventsCounterService(db, fx.teammateCtx).read(fx.projectId);
    expect(counter.state.status).not.toBe("not_connected");
    expect(counter.totalReceived).toBeGreaterThan(0);

    const state = await createConnectionsService(db, fx.teammateCtx, READ_ONLY_DEPS).getState(
      fx.projectId,
    );
    expect(state.status).not.toBe("not_connected");
  });

  // -- item 82
  it("widens nothing when a foreign project id is supplied to a repository", async () => {
    const fx = await seedMatrix(db, "foreign-project");

    // Org B naming org A's project. The client-supplied id path.
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

    // And the mirror direction: org A naming org B's project sees nothing either, so
    // the boundary is not one-sided.
    expect(await createProjectsRepo(db, fx.ownerCtx).findById(fx.foreignProjectId)).toBeNull();
    expect(
      await createSessionsRepo(db, fx.ownerCtx).listForProject(fx.foreignProjectId, { limit: 50 }),
    ).toEqual([]);
  });

  // -- item 82 (services)
  it("widens nothing when a foreign project id is supplied to a service", async () => {
    const fx = await seedMatrix(db, "foreign-project-service");

    const state = await createConnectionsService(db, fx.foreignCtx, READ_ONLY_DEPS).getState(
      fx.projectId,
    );
    // `not_connected` is the honest answer for an org with no attachment on a project
    // it cannot see, never org A's connection summary.
    expect(state.status).toBe("not_connected");
    expect(JSON.stringify(state)).not.toContain(fx.connectionId);

    const counter = await createEventsCounterService(db, fx.foreignCtx).read(fx.projectId);
    expect(counter.state.status).toBe("not_connected");
    expect(counter.totalReceived).toBe(0);
    expect(counter.kept).toBe(0);
    expect(counter.droppedUnreadable).toBe(0);
  });
});

// · `detector-corpus.service`, the T1 corpus read.
//
// Add docs/adds/t1-detectors-evidence-gate.md "Integration, `packages/db`", written red
// against Wave 1's final signature and before the Wave 5 body exists. That order is
// deliberate: this is a tenancy boundary, and a test written after an implementation is
// shaped by the implementation rather than by the contract.
//
// Every test below must fail with "not implemented" (the scaffold's throw) except the
// source assertion, which fails on its missing pattern because the queries it inspects
// have not been written yet. Neither may ever fail on a fixture collision or a compile
// error; both prior sprint retros name that as the red state that isn't.
//
// Its own lane prefix, `db-dc-`: no other suite in this package uses it, so no org
// name, user email, project name, or session key here can collide with the `xt` / `ev`
// / `pc` / `se` / `sym` / `claim` / `sys` lanes.
//
// Every instant is a fixture constant. Nothing in this block reads a clock,
// `Date.now` in a time column is what made 18 worker tests fail time-of-day-flaky for
// a whole sprint run.

const CORPUS_NAMES = laneNames("dc");

const CORPUS_SERVICE_SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "services",
  "detector-corpus.service.ts",
);

/** The injected analysis window. Never derived from a clock. */
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
  /** The org owner, the person who set the connection up. */
  ctx: TenantContext;
  /** A non-owner member of the same org. The / audience cell. */
  teammateCtx: TenantContext;
  organizationId: string;
  projectId: string;
  connectionId: string;
}

/**
 * One org, one project, one healthy attachment, one non-owner teammate, and, unless the
 * caller asks for the never-polled shape, one completed poll run.
 *
 * The teammate is seeded always, not only for the test that reads as them, so the org's
 * shape is identical across every test here and the teammate read is the only variable.
 */
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

/** The event fixture's default path. Only ever applied when the spec omits `urlPath`.
 * See the `=== undefined` note on the seeder. */
const CORPUS_DEFAULT_URL_PATH = "/pricing";

interface CorpusEventSpec {
  readonly sourceEventId: string;
  readonly occurredAt: Date;
  readonly name?: string;
  /** `null` means "this event carries no path". The / case the detector counts
   * into `coverage.eventsWithoutUrlPath`. It must survive the seeder as `null`; see the
   * `=== undefined` note there. */
  readonly urlPath?: string | null;
  /** `null` means "written before versions were recorded. Redaction status unknown",
   * and is never coerced to `0`. Omit for the current version, which is what
   * the write path stamps. */
  readonly urlPathNormalisationVersion?: number | null;
}

interface CorpusSessionSpec {
  readonly sessionKey: string;
  readonly startedAt: Date;
  readonly exclusionReason?: ExclusionReason;
  readonly events: readonly CorpusEventSpec[];
}

/**
 * Bulk arrange step. Writes sessions and their events in two statements because the cap
 * test needs 501 sessions and a per-row seeder would dominate the suite's runtime.
 *
 * Local to this file rather than added to `helpers/db-lane-fixtures.ts`: that module is
 * a shared surface, and the row shapes here (a per-session event list, explicit
 * `started_at` and `occurred_at` on every row) exist only to express the cap and the
 * window boundary.
 *
 * Returns `sessionKey → session id`, because `SessionTimeline` identifies a session by
 * its id and the specs identify it by its key.
 */
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
      // `=== undefined`, not `??`, the same rule as the event rows below. A first event
      // that deliberately carries NO path must give the session a null
      // `entry_url_path`, not the default one.
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
        // `=== undefined`, not `??`, an explicitly seeded `null` is an event that
        // carries NO path, and `??` would coerce it back to the default and quietly
        // destroy the only fixture that can exercise /the path-less event through
        // the real read. `helpers/db-lane-fixtures.ts` was rewritten to this shape for
        // the same reason.
        urlPath: event.urlPath === undefined ? CORPUS_DEFAULT_URL_PATH : event.urlPath,
        // From the constant, never a hardcoded number. A version bump must not silently
        // invalidate the round-trip assertion below. Same `=== undefined` rule: an
        // explicit `null` is a pre-versioning row.
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

/** Throws rather than returning `undefined`, so a mis-keyed lookup is a loud fixture
 * bug instead of a silent `expect(undefined)`. */
function sessionIdOf(ids: ReadonlyMap<string, string>, sessionKey: string): string {
  const id = ids.get(sessionKey);
  if (id === undefined) {
    throw new Error(`seedCorpusSessions: no session id seeded for "${sessionKey}"`);
  }
  return id;
}

/** Session `i` of the cap fixture starts `i` minutes after `CAP_BASE`, so `i = 0` is
 * the oldest and is exactly the one a `started_at DESC` cap must drop. */
function capSessionKey(index: number): string {
  return `ph:db-dc-cap-${index}`;
}

/** Removes block and line comments, so the header prose promising `ctx.organizationId`
 * can never satisfy a source assertion about the code. */
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

  // -- tenancy: / /

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

    // An empty corpus, not org A's. The return type has no `null` arm, so the only way
    // this read can be wrong is by being populated.
    expect(corpus.sessions).toEqual([]);
    expect(corpus.basis.totalInWindow).toBe(0);
    expect(corpus.basis.kept).toBe(0);
    expect(corpus.basis.setAside).toEqual([]);
    // Org B cannot even learn that org A has an attachment.
    expect(corpus.connectionState.status).toBe("not_connected");

    // Nothing of org A's leaks through any field, including ones a later change might
    // add. The serialised form is checked, not just `sessions`.
    const serialised = JSON.stringify(corpus);
    expect(serialised).not.toContain(sessionIdOf(ids, "ph:db-dc-tenancy-a-1"));
    expect(serialised).not.toContain("db-dc-tenancy-a-evt-1");
    expect(serialised).not.toContain(orgA.connectionId);
  });

  it("detector-corpus.service returns everything to org A's non-owner teammate", async () => {
    // The flagship cell. An org-scoped corpus that only the person who connected the
    // source can read is the single most-missed failure in the whole edge-case
    // taxonomy: the feature works for its author and is silently empty for their whole
    // team.
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
    // The teammate sees the same connection story the owner does.
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

    // Org A naming org b's project. The failure this guards against is not only a
    // cross-tenant read: it is a project predicate that is dropped or ignored, which
    // would hand org A its own corpus under someone else's id.
    const aReadingB = await service.read(orgB.projectId, WINDOW);
    expect(aReadingB.sessions).toEqual([]);
    expect(aReadingB.basis.totalInWindow).toBe(0);
    expect(aReadingB.connectionState.status).toBe("not_connected");
    expect(JSON.stringify(aReadingB)).not.toContain(sessionIdOf(idsB, "ph:db-dc-foreign-b-1"));
    expect(JSON.stringify(aReadingB)).not.toContain(sessionIdOf(idsA, "ph:db-dc-foreign-a-1"));

    // The mirror direction, so the boundary is not one-sided.
    const bReadingA = await createDetectorCorpusService(db, orgB.ctx).read(orgA.projectId, WINDOW);
    expect(bReadingA.sessions).toEqual([]);
    expect(bReadingA.basis.totalInWindow).toBe(0);
    expect(JSON.stringify(bReadingA)).not.toContain(sessionIdOf(idsA, "ph:db-dc-foreign-a-1"));
  });

  it("detector-corpus.service names organization_id on both sides of the events↔sessions join", () => {
    // A source assertion, because behaviour cannot make this total. A read that
    // establishes tenancy by joining to an already-scoped table passes every
    // behavioural test above and is one refactor away from establishing none. That is
    // the exact mechanism behind the sibling cross-tenant incident, and
    // `events-counter.service.ts` already carries this same both-sides shape.
    const source = readFileSync(CORPUS_SERVICE_SOURCE_PATH, "utf8");
    const code = stripSourceComments(source);

    // Guard against a vacuous pass: the file must actually have been read, and the
    // comment stripper must not have eaten the code.
    expect(source.length).toBeGreaterThan(0);
    expect(code).toContain("createDetectorCorpusService");

    // A count, not a match (security audit ). `.from(events)` appears twice in this
    // file. The windowed events read and the project-wide `anyEvent` probe, and a
    // single `toMatch` passes while one of the two has had its org predicate dropped.
    // The `anyEvent` probe is the weakest cell: its only observable effect is
    // `connectionState`, and that is short-circuited to `not_connected` when
    // `findLatestConnection` returns null, so no behavioural cross-tenant test can
    // reach it. Ruling 35 / That decision says every predicate names
    // `ctx.organizationId` out loud; only a per-query count can say that.
    //
    // The expected count is derived from the source, so adding a sixth scoped query
    // raises the bar automatically instead of leaving the new query uncovered by a
    // hard-coded number.
    const countOf = (pattern: RegExp): number => (code.match(pattern) ?? []).length;

    const sessionReads = countOf(/\.from\(\s*sessions\s*\)/g);
    const eventReads = countOf(/\.from\(\s*events\s*\)/g);

    // Guard against a vacuous pass a second time: a count assertion over zero queries
    // is satisfied by a file that reads nothing at all.
    expect(sessionReads).toBeGreaterThan(0);
    expect(eventReads).toBeGreaterThan(0);

    expect(countOf(/eq\(\s*sessions\.organizationId\s*,\s*ctx\.organizationId\s*\)/g)).toBe(
      sessionReads,
    );
    expect(countOf(/eq\(\s*events\.organizationId\s*,\s*ctx\.organizationId\s*\)/g)).toBe(
      eventReads,
    );
  });

  // -- corpus semantics:, the session cap

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

      // The assertion. A half-loaded session fabricates a drop-off: the events proving
      // the user reached the destination are exactly the ones a mid-session cap
      // dropped, so the detector reports a completion as an abandonment. Every returned
      // session carries all three of its events, or the cap was applied to events
      // instead of to sessions.
      const distinctEventCounts = [
        ...new Set(corpus.sessions.map((session) => session.events.length)),
      ];
      expect(distinctEventCounts).toEqual([EVENTS_PER_SESSION]);
      expect(corpus.sessions.flatMap((session) => session.events).length).toBe(
        DETECTOR_CORPUS_MAX_SESSIONS * EVENTS_PER_SESSION,
      );

      // The cap drops whole sessions, from the oldest end.
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

      // the That decision was a silent truncation that read as "no more events". This
      // is that fix applied before the incident rather than after it.
      expect(bound.coverage.truncated).toBe(true);
      // And the control: `truncated` must be a fact about the read, not a constant. A
      // read the cap did not bind says so.
      expect(unbound.coverage.truncated).toBe(false);
      expect(unbound.sessions.length).toBe(UNDER_CAP);
    });
  });

  // -- corpus semantics: /, the denominator

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

    // Ruling 7: the corpus does not pre-filter to kept. Every selected session is
    // returned carrying its own `exclusionReason`, and the detector applies, which is
    // what keeps asserted against the tested pure layer rather than against an untested
    // SQL read.
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

    // …and the denominator excludes them. A bot never had the opportunity to convert,
    // so counting it understates every rate this corpus can support.
    expect(corpus.basis.totalInWindow).toBe(5);
    expect(corpus.basis.kept).toBe(3);

    // The gap is explained, in the customer's own terms, reusing the vocabulary the
    // shipped counter already renders.
    expect(corpus.basis.setAside.toSorted((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      {
        reason: "automation_headless",
        count: 1,
        label: EXCLUSION_REASON_LABELS.automation_headless,
      },
      { reason: "internal_domain", count: 1, label: EXCLUSION_REASON_LABELS.internal_domain },
    ]);
    // "none" means classified and kept, never also a set-aside row, or the identity
    // below would hold while double-counting.
    expect(corpus.basis.setAside.map((row) => row.reason)).not.toContain("none");

    // The identity, asserted rather than hoped for.
    const setAsideTotal = corpus.basis.setAside.reduce((total, row) => total + row.count, 0);
    expect(corpus.basis.kept + setAsideTotal).toBe(corpus.basis.totalInWindow);
  });

  // -- corpus semantics:, the window

  it("detector-corpus.service selects sessions by started_at within the window and returns their events whole", async () => {
    const org = await seedCorpusOrg(db, "window");
    const ids = await seedCorpusSessions(db, org, [
      {
        // Exactly at the window's start. Boundaries are inclusive.
        sessionKey: "ph:db-dc-window-at-start",
        startedAt: WINDOW.start,
        events: [
          {
            // Before the window opened, and it must still be returned: the window
            // anchors on the session, not on the event.
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
        // Exactly at the window's end. Inclusive too.
        sessionKey: "ph:db-dc-window-at-end",
        startedAt: WINDOW.end,
        events: [
          {
            // After the window closed, and it must still be returned.
            sourceEventId: "db-dc-window-at-end-late",
            occurredAt: new Date(WINDOW.end.getTime() + HOUR_MS),
          },
        ],
      },
      {
        // One millisecond before the window. Out, even though its event is in.
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
        // One millisecond after the window. Out, even though its event is in.
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
    // Selecting by event time instead would pull both of these in and cut the two above
    // at the boundary. Reintroducing the fabricated drop-off through a different door.
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-window-before"))).toBe(false);
    expect(returned.has(sessionIdOf(ids, "ph:db-dc-window-after"))).toBe(false);
    expect(corpus.sessions.length).toBe(2);
    expect(corpus.basis.totalInWindow).toBe(2);

    // Whole sessions: every event of a selected session, regardless of its own
    // `occurred_at`.
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

  // -- corpus semantics: /, the path and its version

  it("detector-corpus.service returns a path-less event as null and never coerces an unknown version to 0", async () => {
    // What this pins, and why it needs the real read. Two `null`s cross this boundary
    // and both mean something the detector acts on:
    //
    // `url_path = null`, the event carries no surface. `error_event`
    //  attributes it to no surface at all rather than to a guessed one, and
    //  `analysedSessions` counts it into `coverage.eventsWithoutUrlPath` so
    //  the omission is reported rather than silent. A read that
    //  substituted a default path would manufacture a surface out of nothing
    //  and hide the coverage loss at the same time.
    // `url_path_normalisation_version = null`, "written before versions
    //  were recorded, redaction status unknown". It is never coerced
    //  to `0`, which would claim a normalisation that never ran; ruling 28's
    //  unanimous-or-null rule is what consumes it.
    //
    // Nothing above this line seeds either `null`, because `??` in the fixture silently
    // replaced both. This is the assertion that keeps the seeder's `=== undefined`
    // honest.
    const org = await seedCorpusOrg(db, "nulls");
    const NULLS_BASE = new Date("2026-07-23T08:00:00.000Z");
    const ids = await seedCorpusSessions(db, org, [
      {
        sessionKey: "ph:db-dc-nulls-1",
        startedAt: NULLS_BASE,
        events: [
          {
            // No path at all, and no recorded version. A pre-versioning row.
            sourceEventId: "db-dc-nulls-pathless",
            occurredAt: NULLS_BASE,
            urlPath: null,
            urlPathNormalisationVersion: null,
          },
          {
            // A path, stamped by the current write path.
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

    // Non-vacuity: both rows really did come back, so the `null` assertions below are
    // about the values and not about a missing event.
    expect(pathless).toBeDefined();
    expect(pathed).toBeDefined();

    // The path-less event survives as `null`, not as a default, not dropped.
    expect(pathless?.urlPath).toBeNull();
    // ...and `null` is never `0`. `?? 0` at the mapping in
    // `detector-corpus.service.ts` would pass a `toBeFalsy` and fail this.
    expect(pathless?.urlPathNormalisationVersion).toBeNull();
    expect(pathless?.urlPathNormalisationVersion).not.toBe(0);

    // The control, from the constant rather than a hardcoded number: a version bump
    // changes what the write path stamps, and this assertion must follow it instead of
    // silently pinning a stale value.
    expect(pathed?.urlPath).toBe("/checkout");
    expect(pathed?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);
    // The two rows really do disagree, so neither assertion can be satisfied by a read
    // that returned one value for every event.
    expect(pathed?.urlPathNormalisationVersion).not.toBe(pathless?.urlPathNormalisationVersion);

    // The session's own entry path follows the same rule: a first event with no path
    // gives a null `entry_url_path`, never the fixture's default.
    expect(session?.entryUrlPath).toBeNull();
  });

  // -- vs

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

    // Both corpora are empty, and an empty `sessions` array alone cannot tell these
    // apart. `connectionState`, from the existing `deriveConnectionState`, never a
    // second copy of the branch order. Is what makes them two different answers to the
    // customer.
    expect(polledCorpus.sessions).toEqual([]);
    expect(neverCorpus.sessions).toEqual([]);
    expect(polledCorpus.basis.totalInWindow).toBe(0);
    expect(neverCorpus.basis.totalInWindow).toBe(0);

    expect(polledCorpus.connectionState.status).toBe("connected_no_events_yet");
    expect(neverCorpus.connectionState.status).toBe("connected_never_polled");
    expect(polledCorpus.connectionState.status).not.toBe(neverCorpus.connectionState.status);
  });
});

// · cross-tenant boundary on the signature ledger tables (`finding_signatures`,
// `dismissals`, `signature_ancestry`).
//
// Add tasks/signature-ledger/add.md "Cross-tenant + scope", Multi-tenancy.
// Appended per this file's own collision-surface note (C-6 in the add). Append only,
// never reorder the / blocks above.
//
// Every read-back goes through the public repository/service contract, the same
// discipline the block above already established. Reading rows directly would prove
// nothing about scoping.
//
// Every repository/service method body under test here is a Wave 0B typed stub that
// throws "not implemented" (see `packages/db/src/repositories/
// finding-signatures.repo.ts`, `dismissals.repo.ts`, `signature-ancestry.repo.ts`, and
// `services/signature-ledger.service.ts`). Every test below must fail for that reason
// today, never a compile error. The assertions are written against the final contract
// so they need no rewrite once Waves 4-5 land.

/**
 * Builds a syntactically valid `SignatureHex` for fixture purposes only.
 * `signatureHex`/`sha256Hex` (`../../src/signatures/hex`) are themselves Wave 0B stubs
 * that throw "not implemented", so nothing in this file can mint a real digest yet. A
 * real sha256 hex digest of an arbitrary label is used only because it is guaranteed to
 * be 64 lowercase hex characters and distinct per label, never because this file is
 * testing `sha256Hex` itself (that is `signatures/hex.test.ts`'s job).
 */
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

/**
 * Org A (owner + a non-owner teammate) with a ledger row already recorded via the real
 * write path (`upsertSeen`), plus org B with its own project. Every new describe block
 * below calls this with a distinct `label` so the `xt` lane's fixture names never
 * collide across tests.
 */
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

  // -- T-XT-1
  it("org B reads nothing of org A's ledger, dismissals, or ancestry", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-read");
    const newSignature = fakeSignature("sig-read-a-new");

    // Real data for org A on all three tables, so org B's reads have something genuine
    // to fail to see. An empty table proves nothing about tenancy.
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
    // Org B has no edge of its own, so the walk degrades cleanly to the input signature
    // at zero hops, the same empty-table behaviour T-DB-9 pins, here proved from the
    // other org's vantage point.
    expect(await ancestryB.resolve(fx.signature)).toEqual({
      resolution: "resolved",
      signature: fx.signature,
      hops: 0,
    });
  });

  // -- T-XT-2
  it("org B mutates nothing of org A's — markDelivered, dismissal, and carry-forward all return null or no rows, never a silent success", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-mutate");
    const newSignature = fakeSignature("sig-mutate-a-new");

    const deliveredByB = await createFindingSignaturesRepo(db, fx.foreignCtx).markDelivered(
      fx.projectId,
      fx.signature,
      new Date("2026-07-30T13:00:00.000Z"),
    );
    expect(deliveredByB).toBeNull();

    // Either a refusal or a no-op that creates nothing under org A is acceptable. A
    // silent success that mutates org A's row is not, and that is what the read-back
    // below proves. Same idiom as the hostile session upsert above (item 80).
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

    // The read-back, under org a's own context, proves nothing changed.
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

  // -- T-XT-3 (flagship, the single most important row in this file)
  it("org A's non-owner teammate CAN read the ledger, CAN dismiss, and their dismissal suppresses for the owner", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-teammate");
    expect(fx.teammateCtx.role).toBe("member");
    expect(fx.teammateCtx.userId).not.toBe(fx.ownerCtx.userId);

    // Can read, as the teammate, never routed through the owner's context.
    const ledgerRow = await createFindingSignaturesRepo(db, fx.teammateCtx).findBySignature(
      fx.projectId,
      fx.signature,
    );
    expect(ledgerRow?.signature).toBe(fx.signature);

    // Can dismiss, as the teammate. A dismissal is an org-scoped effect one member
    // triggers on behalf of everyone, never gated to whoever set the product up
    // (architecture.md:528-529).
    const dismissal = await createSignatureLedgerService(db, fx.teammateCtx).recordDismissal({
      projectId: fx.projectId,
      findingId: fx.findingId,
      signature: fx.signature,
      action: "not_useful",
      dismissedByUserId: fx.teammateCtx.userId,
    });
    expect(dismissal.dismissedByUserId).toBe(fx.teammateCtx.userId);

    // …and suppresses for the owner. The classic miss is narrowing an org-wide effect
    // to whoever triggered it. Asserted here, never assumed.
    const decision = await createSignatureLedgerService(db, fx.ownerCtx).consultSignature(
      fx.projectId,
      fx.signature,
    );
    expect(decision).toEqual({ decision: "suppress", reason: "dismissed" });
  });

  // -- T-XT-4 (the reverse direction)
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

  // -- T-XT-5
  it("a client-supplied foreign project id widens nothing through any of the three repositories or the service", async () => {
    const fx = await seedSignatureLedgerMatrix(db, "sig-foreign-project");

    // Org A naming org B's project id against org A's own signature. The failure this
    // guards against is not a cross-org read: it is a project predicate that gets
    // dropped, which would hand org A its own ledger row back under someone else's
    // project id.
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
    // A foreign project id must never widen the read to org A's own signature recorded
    // against its real project. The honest answer is "never seen on this project", not
    // org A's real ledger state.
    expect(decision).toEqual({ decision: "deliver", reason: "not_seen_before" });
  });
});
