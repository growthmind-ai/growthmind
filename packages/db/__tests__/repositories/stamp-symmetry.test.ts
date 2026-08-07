import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { browserCut, URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import type { SessionSourcePullResult, TenantContext } from "@growthmind/shared";

import { and, eq } from "drizzle-orm";

import { createDivergencePointsRepo } from "../../src/repositories/divergence-points.repo";
import { createEventsRepo } from "../../src/repositories/events.repo";
import { createPollRunsRepo } from "../../src/repositories/poll-runs.repo";
import { createProjectConnectionsRepo } from "../../src/repositories/project-connections.repo";
import { createSessionsRepo } from "../../src/repositories/sessions.repo";
import { persistPullResult } from "../../src/services/intake.service";
import {
  claimDuePollableConnections,
  systemContextFor,
  systemTenantContextFor,
  SYSTEM_ACTOR,
  type PollableConnection,
} from "../../src/system";
import * as schema from "../../src/schema";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, scannedTextFor } from "../../src/testing";
import {
  makeTenantContext,
  seedConnection,
  seedMember,
  seedOrgWithOwner,
  seedProject,
  seedUser,
} from "../../src/testing";
import {
  SESSION_GROUPING_VERSION,
  recordingSessionKey,
  transcriptOf,
  transcriptRepo,
} from "../helpers/transcript-contract";

import { createHash, randomUUID } from "node:crypto";

import { buildFindingDeliveredDedupKey, buildKeysRevokedDedupKey } from "@growthmind/shared";

import { emitNotification } from "../../src/notifications/emit";
import { createNotificationMutesRepo } from "../../src/repositories/notification-mutes.repo";
import { createNotificationSettingsRepo } from "../../src/repositories/notification-settings.repo";
import { createNotificationsRepo } from "../../src/repositories/notifications.repo";
import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import { createFindingSignaturesRepo } from "../../src/repositories/finding-signatures.repo";
import { createSignatureAncestryRepo } from "../../src/repositories/signature-ancestry.repo";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";

const NAMES = laneNames("sym");

const NOW = new Date("2026-07-30T12:00:00.000Z");
const DUE_AT = new Date("2026-07-30T11:59:00.000Z");
const EVENT_AT = new Date("2026-07-30T11:58:00.000Z");

const BROWSER_SAFARI_CUT = browserCut("safari");

const DIVERGENCE_WINDOW_START = new Date("2026-07-23T00:00:00.000Z");
const DIVERGENCE_WINDOW_END = new Date("2026-07-30T00:00:00.000Z");

interface WorkerScope {
  requestCtx: TenantContext;

  systemCtx: TenantContext;
  connection: PollableConnection;
  projectId: string;
  connectionId: string;
}

async function claimAsWorker(db: TestDb, label: string): Promise<WorkerScope> {
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
    nextPollAt: DUE_AT,
  });

  const claimed = await claimDuePollableConnections(db, { now: NOW, limit: 10 });
  const mine = claimed.find((row) => row.id === connection.id);
  if (!mine) {
    throw new Error("expected the due connection to be claimed by the scheduler");
  }

  return {
    requestCtx: org.ctx,
    systemCtx: systemTenantContextFor(mine),
    connection: mine,
    projectId: project.id,
    connectionId: connection.id,
  };
}

function noPathSourceEventId(sourceEventId: string): string {
  return `${sourceEventId}-nopath`;
}

function makePullResult(sessionKey: string, sourceEventId: string): SessionSourcePullResult {
  return {
    ok: true,
    sessions: [
      {
        sessionKey,
        identityKey: "db-sym-distinct-0001",
        identityEmailDomain: null,
        identityResolution: "unresolved",
        userAgent: null,
        entryUrlPath: "/pricing",
        startedAt: EVENT_AT,
        lastEventAt: EVENT_AT,
      },
    ],
    events: [
      {
        sourceEventId,
        sessionKey,
        name: "$pageview",
        occurredAt: EVENT_AT,
        urlPath: "/pricing",
      },

      {
        sourceEventId: noPathSourceEventId(sourceEventId),
        sessionKey,
        name: "$identify",
        occurredAt: EVENT_AT,
        urlPath: null,
      },
    ],
    newestObservedAt: EVENT_AT,
    contiguous: true,
    resumeBefore: null,
    pagesFetched: 1,
    droppedMalformed: 0,
    identityLookupsUsed: 0,
    eventsReceived: 2,
  };
}

describe("stamp/filter symmetry — the worker writes it, the scoped read serves it", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("returns a connection the worker updated from the request-scoped connection read", async () => {
    const scope = await claimAsWorker(db, "connection");

    const workerRepo = createProjectConnectionsRepo(db, scope.systemCtx);
    const advanced = await workerRepo.advanceWatermark(scope.connectionId, {
      watermarkAt: EVENT_AT,
      backfillBefore: null,
    });
    expect(advanced).not.toBeNull();
    await workerRepo.recordHealth(scope.connectionId, {
      health: "healthy",
      reasonCode: null,
      reasonMessage: null,
      checkedAt: NOW,
    });

    const served = await createProjectConnectionsRepo(db, scope.requestCtx).getActiveForProject(
      scope.projectId,
    );
    expect(served?.id).toBe(scope.connectionId);
    expect(served?.watermarkAt?.getTime()).toBe(EVENT_AT.getTime());
    expect(served?.health).toBe("healthy");
    expect(served?.organizationId).toBe(scope.requestCtx.organizationId);
  });

  it("returns a session the worker persisted from the request-scoped session read", async () => {
    const scope = await claimAsWorker(db, "session");
    const sessionKey = "ph:db-sym-session";

    await persistPullResult(db, scope.systemCtx, {
      connection: {
        id: scope.connectionId,
        projectId: scope.projectId,
        inferredInternalDomain: null,
      },
      result: makePullResult(sessionKey, "db-sym-session-0001"),
    });

    const sessionsRepo = createSessionsRepo(db, scope.requestCtx);
    const listed = await sessionsRepo.listForProject(scope.projectId, { limit: 50 });
    expect(listed.map((session) => session.sessionKey)).toContain(sessionKey);

    const byKey = await sessionsRepo.findByKey(scope.projectId, sessionKey);
    expect(byKey).not.toBeNull();

    expect(byKey?.organizationId).toBe(scope.requestCtx.organizationId);
    expect(byKey?.projectId).toBe(scope.projectId);
    expect(byKey?.connectionId).toBe(scope.connectionId);
  });

  it("returns an event the worker persisted from the request-scoped event read", async () => {
    const scope = await claimAsWorker(db, "event");
    const sessionKey = "ph:db-sym-event";
    const sourceEventId = "db-sym-event-0001";

    const counts = await persistPullResult(db, scope.systemCtx, {
      connection: {
        id: scope.connectionId,
        projectId: scope.projectId,
        inferredInternalDomain: null,
      },
      result: makePullResult(sessionKey, sourceEventId),
    });
    expect(counts.eventsPersisted).toBe(2);

    const eventsRepo = createEventsRepo(db, scope.requestCtx);
    const listed = await eventsRepo.listForProject(scope.projectId, { limit: 50 });
    const served = listed.find((event) => event.sourceEventId === sourceEventId);
    expect(served).toBeDefined();
    expect(served?.organizationId).toBe(scope.requestCtx.organizationId);
    expect(served?.projectId).toBe(scope.projectId);

    expect(served?.urlPath).toBe("/pricing");
    expect(served?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);

    const noPath = listed.find(
      (event) => event.sourceEventId === noPathSourceEventId(sourceEventId),
    );
    expect(noPath).toBeDefined();
    expect(noPath?.urlPath).toBeNull();
    expect(noPath?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);

    const sessionRow = await createSessionsRepo(db, scope.requestCtx).findByKey(
      scope.projectId,
      sessionKey,
    );
    if (!sessionRow) {
      throw new Error("expected the worker-written session to be readable");
    }
    const forSession = await eventsRepo.listForSession(sessionRow.id, { limit: 50 });
    expect(forSession.map((event) => event.sourceEventId)).toContain(sourceEventId);
  });

  it("returns a poll run the worker finished from the request-scoped poll-run read", async () => {
    const scope = await claimAsWorker(db, "poll-run");

    const workerRuns = createPollRunsRepo(db, scope.systemCtx);
    const started = await workerRuns.start({
      projectId: scope.projectId,
      connectionId: scope.connectionId,
      startedAt: NOW,
    });
    expect(started.status).toBe("running");

    const finished = await workerRuns.finish(started.id, {
      status: "completed",
      finishedAt: new Date("2026-07-30T12:00:05.000Z"),
      outcome: "with_events",
      watermarkAdvancedTo: EVENT_AT,
      eventsReceived: 1,
      eventsPersisted: 1,
      eventsDroppedMalformed: 0,
      sessionsTouched: 1,
      pagesFetched: 1,
      identityLookupsUsed: 0,
    });
    expect(finished).not.toBeNull();

    const requestRuns = createPollRunsRepo(db, scope.requestCtx);
    const latest = await requestRuns.latestCompletedFor(scope.connectionId);
    expect(latest?.id).toBe(started.id);
    expect(latest?.organizationId).toBe(scope.requestCtx.organizationId);
    expect(latest?.outcome).toBe("with_events");

    const aggregate = await requestRuns.aggregateFor(scope.connectionId);
    expect(aggregate.runsCompleted).toBe(1);
    expect(aggregate.runsFailed).toBe(0);
    expect(aggregate.lastSuccessfulFinishedAt).not.toBeNull();
  });

  it("should read back the session_key the narration tick stamped", async () => {
    const scope = await claimAsWorker(db, "recording-summary");
    const narrationCtx = systemContextFor(SYSTEM_ACTOR.REPLAY_NARRATION_TICK, {
      organizationId: scope.requestCtx.organizationId,
      organizationName: scope.requestCtx.organizationName,
    });

    const recordingId = "0198c4f2-7a1b-7c3d-9e4f-stamp-symmetry";
    const sessionKey = recordingSessionKey("posthog", recordingId);
    const scanned = scannedTextFor("Someone pressed buy and nothing happened", [
      "They opened pricing, pressed buy four times, and left.",
    ]);

    await transcriptRepo(db, narrationCtx).persist({
      projectId: scope.projectId,
      recordingId,
      summarySource: "model_rendered",
      headline: scanned.headline,
      context: scanned.context,
      transcript: "0:00  opened /pricing",
      pages: ["/pricing"],
      durationMs: 92_000,
      actionCount: 2,
      notableCount: 1,
      droppedEvents: 0,
      startedAt: EVENT_AT,
      resolvedModelId: "test-model",
      provider: "posthog",
      sessionKey,
      sessionGroupingVersion: SESSION_GROUPING_VERSION,
      actions: transcriptOf([{ kind: "page", atMs: 0 }]),
      actionsVersion: 1,
      actionsOmitted: 0,
      pullStop: "exhausted",
      pullReason: null,
      pullWatermarkAt: EVENT_AT,
    });

    const served = await transcriptRepo(db, scope.requestCtx).findFor(scope.projectId, recordingId);

    expect(served).not.toBeNull();
    expect(served?.organizationId).toBe(scope.requestCtx.organizationId);
    expect(served?.projectId).toBe(scope.projectId);
    expect(served?.sessionKey).toBe(sessionKey);
    expect(served?.sessionGroupingVersion).toBe(SESSION_GROUPING_VERSION);
  });

  it("should stamp organization_id on a per-cut divergence row the analysis tick wrote", async () => {
    const scope = await claimAsWorker(db, "divergence-cut");

    await createDivergencePointsRepo(db, scope.systemCtx).recordDivergence({
      projectId: scope.projectId,
      surface: "/pricing",
      cohortCut: BROWSER_SAFARI_CUT,
      surfaceNormalisationVersion: 2,
      spineVersion: 1,
      cohortMatchVersion: 1,
      windowStart: DIVERGENCE_WINDOW_START,
      windowEnd: DIVERGENCE_WINDOW_END,
      kind: "refused",
      divergedAtRank: null,
      reason: "cohort_below_floor",
      succeededCohortSize: 2,
      failedCohortSize: 3,
      succeededSessionIdsSample: [],
      failedSessionIdsSample: [],
    });

    const served = await db
      .select()
      .from(schema.divergencePoints)
      .where(
        and(
          eq(schema.divergencePoints.organizationId, scope.requestCtx.organizationId),
          eq(schema.divergencePoints.projectId, scope.projectId),
        ),
      );

    expect(served).toHaveLength(1);
    expect(served[0]?.cohortCut).toBe(BROWSER_SAFARI_CUT);
    expect(served[0]?.organizationId).toBe(scope.requestCtx.organizationId);
  });
});

function fakeSignature(label: string): SignatureHex {
  return createHash("sha256").update(label).digest("hex") as unknown as SignatureHex;
}

describe("stamp/filter symmetry — the signature ledger tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("returns a ledger row the record path wrote from the request-scoped consult read", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("sig-ledger"),
      userName: NAMES.userName("sig-ledger"),
      email: NAMES.email("sig-ledger"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("sig-ledger"),
    });
    const signature = fakeSignature("sig-ledger-symmetry");

    await createFindingSignaturesRepo(db, org.ctx).upsertSeen({
      projectId: project.id,
      signature,
      symptomClass: "broken",
      surface: "/checkout",
      signatureTupleVersion: 1,
      evidenceShapeVersion: 1,
      surfaceNormalisationVersion: 2,
      seenAt: new Date("2026-07-30T12:00:00.000Z"),
    });

    const served = await createFindingSignaturesRepo(db, org.ctx).findBySignature(
      project.id,
      signature,
    );

    expect(served).not.toBeNull();

    expect(served?.organizationId).toBe(org.organizationId);
    expect(served?.projectId).toBe(project.id);
    expect(served?.signature).toBe(signature);
  });

  it("returns a dismissal the write path stamped from the request-scoped suppression read", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("sig-dismissal"),
      userName: NAMES.userName("sig-dismissal"),
      email: NAMES.email("sig-dismissal"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("sig-dismissal"),
    });
    const signature = fakeSignature("sig-dismissal-symmetry");
    const findingId = "db-sym-sig-dismissal-finding-0001";

    await createSignatureLedgerService(db, org.ctx).recordDismissal({
      projectId: project.id,
      findingId,
      signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });

    const served = await createDismissalsRepo(db, org.ctx).findFor(findingId, "not_useful");

    expect(served).not.toBeNull();

    expect(served?.organizationId).toBe(org.organizationId);
    expect(served?.projectId).toBe(project.id);
    expect(served?.findingId).toBe(findingId);
    expect(served?.signature).toBe(signature);
    expect(served?.action).toBe("not_useful");
  });

  it("resolves through an ancestry row the record path wrote, and asserts project_id was stamped despite never being filtered", async () => {
    const org = await seedOrgWithOwner(db, {
      orgName: NAMES.orgName("sig-ancestry"),
      userName: NAMES.userName("sig-ancestry"),
      email: NAMES.email("sig-ancestry"),
    });
    const project = await seedProject(db, {
      organizationId: org.organizationId,
      name: NAMES.projectName("sig-ancestry"),
    });
    const oldSignature = fakeSignature("sig-ancestry-old");
    const newSignature = fakeSignature("sig-ancestry-new");

    await createSignatureLedgerService(db, org.ctx).recordAncestry({
      projectId: project.id,
      oldSignature,
      newSignature,
      reason: "surface_rename",
    });

    const edge = await createSignatureAncestryRepo(db, org.ctx).forwardEdge(oldSignature);
    expect(edge).not.toBeNull();
    expect(edge?.newSignature).toBe(newSignature);

    expect(edge?.projectId).toBe(project.id);

    const resolved = await createSignatureAncestryRepo(db, org.ctx).resolve(oldSignature);
    expect(resolved).toEqual({ resolution: "resolved", signature: newSignature, hops: 1 });
  });
});

describe("stamp/filter symmetry — the notification tables", () => {
  const LIST = { limit: 20, windowDays: 30 } as const;

  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedNotificationOrg(label: string) {
    return seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(label),
      email: NAMES.email(label),
    });
  }

  it("returns a notification and its send receipt the emit seam stamped from the scoped bell read", async () => {
    const org = await seedNotificationOrg("notif-emit");
    const findingId = randomUUID();

    await emitNotification(db, org.organizationId, {
      type: "finding_delivered",
      subjectKind: "finding",
      subjectId: findingId,
      actorUserId: null,
      payload: { type: "finding_delivered", v: 1 },
      dedupKey: buildFindingDeliveredDedupKey(findingId, "C0SYMMETRY"),
      slack: { kind: "copied", channelId: "C0SYMMETRY", messageRef: null, sentAt: new Date() },
    });

    const rows = await createNotificationsRepo(db, org.ctx).listRecentWithReadState(LIST);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectId).toBe(findingId);

    // The send receipt is served through the same org filter its write stamped.
    expect(rows[0]?.sends).toHaveLength(1);
    expect(rows[0]?.sends[0]?.target).toBe("C0SYMMETRY");
  });

  it("returns a badge cleared by the bell-state row the viewer's own stamp wrote", async () => {
    const org = await seedNotificationOrg("notif-bell");

    // Owed with no Slack connection: the quiet receipt lands with the fact, no worker.
    await emitNotification(db, org.organizationId, {
      type: "keys_revoked",
      subjectKind: "agent_key",
      subjectId: randomUUID(),
      actorUserId: org.userId,
      payload: { type: "keys_revoked", v: 1 },
      dedupKey: buildKeysRevokedDedupKey(randomUUID()),
      slack: { kind: "owed" },
    });

    const repo = createNotificationsRepo(db, org.ctx);
    expect(await repo.countNewerThanOpened()).toBe(1);

    await repo.stampOpened();
    expect(await repo.countNewerThanOpened()).toBe(0);
  });

  it("returns a read flag flipped by the reads row markRead stamped", async () => {
    const org = await seedNotificationOrg("notif-reads");

    await emitNotification(db, org.organizationId, {
      type: "keys_revoked",
      subjectKind: "agent_key",
      subjectId: randomUUID(),
      actorUserId: org.userId,
      payload: { type: "keys_revoked", v: 1 },
      dedupKey: buildKeysRevokedDedupKey(randomUUID()),
      slack: { kind: "owed" },
    });

    const repo = createNotificationsRepo(db, org.ctx);
    const [listed] = await repo.listRecentWithReadState(LIST);
    if (!listed) throw new Error("the emitted notification was not served back");
    expect(listed.unread).toBe(true);

    await repo.markRead(listed.id);

    const [after] = await repo.listRecentWithReadState(LIST);
    expect(after?.unread).toBe(false);
  });
});

// O-051 job 2: both new config tables enrol — the write stamps organization_id and the
// scoped read filters on it — rather than being exempted (ADD D-6). RED in Wave 0
// against the throwing repo stubs.
describe("stamp/filter symmetry — the notification config tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedConfigOrg(label: string) {
    return seedOrgWithOwner(db, {
      orgName: NAMES.orgName(label),
      userName: NAMES.userName(label),
      email: NAMES.email(label),
    });
  }

  it("returns the digest settings the save stamped from the scoped read, and defaults across the boundary", async () => {
    const orgA = await seedConfigOrg("config-settings-a");
    const orgB = await seedConfigOrg("config-settings-b");

    await createNotificationSettingsRepo(db, orgA.ctx).save({ cadence: "weekly", day: "friday" });

    const stamped = await db
      .select({ organizationId: schema.notificationSettings.organizationId })
      .from(schema.notificationSettings)
      .where(eq(schema.notificationSettings.organizationId, orgA.organizationId));
    expect(stamped).toHaveLength(1);

    expect((await createNotificationSettingsRepo(db, orgA.ctx).read()).digestDay).toBe("friday");
    expect((await createNotificationSettingsRepo(db, orgB.ctx).read()).digestDay).toBe("monday");
  });

  it("returns the mute the viewer's own write stamped, and nothing for the org's other members", async () => {
    const org = await seedConfigOrg("config-mutes");
    const mate = await seedUser(db, {
      name: NAMES.userName("config-mutes-mate"),
      email: NAMES.email("config-mutes-mate"),
    });
    await seedMember(db, { organizationId: org.organizationId, userId: mate.id, role: "member" });
    const mateCtx = makeTenantContext({
      userId: mate.id,
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      role: "member",
    });

    await createNotificationMutesRepo(db, org.ctx).mute("record");

    const stamped = await db
      .select({
        organizationId: schema.notificationMutes.organizationId,
        userId: schema.notificationMutes.userId,
      })
      .from(schema.notificationMutes)
      .where(eq(schema.notificationMutes.organizationId, org.organizationId));
    expect(stamped).toEqual([{ organizationId: org.organizationId, userId: org.userId }]);

    expect(await createNotificationMutesRepo(db, org.ctx).listMutedClasses()).toEqual(["record"]);
    expect(await createNotificationMutesRepo(db, mateCtx).listMutedClasses()).toEqual([]);
  });
});
