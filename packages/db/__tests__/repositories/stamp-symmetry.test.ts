import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import type { SessionSourcePullResult, TenantContext } from "@growthmind/shared";

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
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames, scannedTextFor } from "../../src/testing";
import { seedConnection, seedOrgWithOwner, seedProject } from "../../src/testing";
import {
  SESSION_GROUPING_VERSION,
  recordingSessionKey,
  transcriptOf,
  transcriptRepo,
} from "../helpers/transcript-contract";

import { createHash } from "node:crypto";

import { createDismissalsRepo } from "../../src/repositories/dismissals.repo";
import { createFindingSignaturesRepo } from "../../src/repositories/finding-signatures.repo";
import { createSignatureAncestryRepo } from "../../src/repositories/signature-ancestry.repo";
import { createSignatureLedgerService } from "../../src/services/signature-ledger.service";
import type { SignatureHex } from "../../src/signatures/hex";

const NAMES = laneNames("sym");

const NOW = new Date("2026-07-30T12:00:00.000Z");
const DUE_AT = new Date("2026-07-30T11:59:00.000Z");
const EVENT_AT = new Date("2026-07-30T11:58:00.000Z");

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
