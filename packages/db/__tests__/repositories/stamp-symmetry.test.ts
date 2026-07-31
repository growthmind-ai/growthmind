// Wave 0b (RED) — lane L3, fixture seed prefix `db-`.
// ADD tasks/session-source-posthog-adapter/add.md §9 items 75–78 — D-2.
//
// THE STAMP/FILTER SYMMETRY PROOF, and it must run through the WORKER's write
// path, not a request path. The failure this exists to prevent is the quiet
// one: a scoped read narrowed by a column the write path never stamps matches
// zero rows, so the screen says "No sessions yet" instead of raising an error,
// and nothing anywhere reports a problem.
//
// So each test below writes exactly as the scheduler will —
//   claimDuePollableConnections → systemTenantContextFor → the repositories /
//   persistPullResult under that system context
// — and then reads back through the SAME scoped read that will serve the
// customer's screen, under a REQUEST context belonging to an org member. If
// the two disagree on a stamp, the read comes back empty and the test fails.
//
// Every function on that path is a typed-stub throw today, so all four tests
// fail on "not implemented".
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
  systemTenantContextFor,
  type PollableConnection,
} from "../../src/system";
import { createTestDb, type TestDb } from "../../src/testing";
import { laneNames } from "../helpers/db-lane-fixtures";
import { seedConnection, seedOrgWithOwner, seedProject } from "../helpers/fixtures";

// --- O-006: the signature ledger's stamp/filter round trips -----------------
// New imports for the appended describe block at the end of this file. Kept
// separate from the group above to minimise the merge-collision surface on
// this file's existing import lines.
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
  /** The context a customer's request would run as — an ordinary org member. */
  requestCtx: TenantContext;
  /** The context the scheduler derives from the claimed row itself. */
  systemCtx: TenantContext;
  connection: PollableConnection;
  projectId: string;
  connectionId: string;
}

/**
 * Seeds a due connection and runs the scheduler's first two steps for real:
 * the atomic claim, then the system context derived FROM the claimed row. No
 * shortcut here — a hand-built system context would let the write path pass a
 * symmetry test the real worker would fail.
 */
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

/** The second event in every pull result below — the one with no `urlPath`. */
function noPathSourceEventId(sourceEventId: string): string {
  return `${sourceEventId}-nopath`;
}

/**
 * ADD §D-15 edit (i), in the only form the port type permits.
 *
 * The ADD asked for `urlPathNormalisationVersion` on this event literal. It
 * cannot go here and it must not: `SourceEvent` (`packages/shared/src/
 * session-source/types.ts`) carries no such field, because the version is
 * stamped by `intake.service.ts` — the write path — not carried across the
 * adapter port. Putting it in the fixture would also make the round-trip
 * assertion below tautological: it would prove pass-through, not the stamp.
 *
 * What the fixture DOES carry, and what makes the stamp assertion mean
 * something, is a second event with `urlPath: null`. The stamp is applied
 * UNCONDITIONALLY, so that row must come back carrying the version too —
 * otherwise `NULL` in the column would mean two different things ("written
 * before versions were recorded" AND "had no path"), and the §5 remediation
 * query `WHERE url_path_normalisation_version IS NULL` could no longer tell a
 * pre-versioning row from a post-versioning one.
 */
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
      // The unconditional-stamp case. A real pull carries plenty of these —
      // `$identify`, `$exception` and anything else PostHog emits without a
      // `$current_url`.
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

  // --- item 77 -------------------------------------------------------------
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

    // The read a customer's screen performs, under their own context.
    const served = await createProjectConnectionsRepo(db, scope.requestCtx).getActiveForProject(
      scope.projectId,
    );
    expect(served?.id).toBe(scope.connectionId);
    expect(served?.watermarkAt?.getTime()).toBe(EVENT_AT.getTime());
    expect(served?.health).toBe("healthy");
    expect(served?.organizationId).toBe(scope.requestCtx.organizationId);
  });

  // --- item 75 -------------------------------------------------------------
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
    // The org stamp the worker wrote must be the one the request read filters
    // on — this is the assertion the whole file exists for.
    expect(byKey?.organizationId).toBe(scope.requestCtx.organizationId);
    expect(byKey?.projectId).toBe(scope.projectId);
    expect(byKey?.connectionId).toBe(scope.connectionId);
  });

  // --- item 76 -------------------------------------------------------------
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

    // ---- ADD §D-15 edit (ii) ------------------------------------------------
    // This suite does not enumerate columns, so no gate would have caught the
    // column going unstamped — the row would simply carry `NULL`, and `NULL`
    // is a legitimate value meaning "written before versions were recorded".
    // A silently unstamped write is therefore indistinguishable from a legacy
    // row, which is exactly the unclassifiable-rows problem the column exists
    // to prevent. Nothing but this line asserts it.
    expect(served?.urlPath).toBe("/pricing");
    expect(served?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);

    // And unconditionally — a row with no path still carries the version, so
    // `NULL` in this column keeps meaning exactly one thing (PL ruling).
    const noPath = listed.find(
      (event) => event.sourceEventId === noPathSourceEventId(sourceEventId),
    );
    expect(noPath).toBeDefined();
    expect(noPath?.urlPath).toBeNull();
    expect(noPath?.urlPathNormalisationVersion).toBe(URL_PATH_NORMALISATION_VERSION);

    // And through the per-session read the evidence view will use.
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

  // --- item 78 -------------------------------------------------------------
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
});

// ===========================================================================
// O-006 · stamp/filter symmetry — the signature ledger tables
// (`finding_signatures`, `dismissals`, `signature_ancestry`).
//
// ADD tasks/signature-ledger/add.md §7 "Stamp/filter symmetry" (T-SS-1..3 /
// T-DB-8), §2 D-10. THREE new hand-written round trips — the fifth, sixth,
// and seventh in this file — appended per the file's own header note that
// NOTHING here is automatic: each writes through the write path under one
// context, then reads back through the SAME scoped read a real consumer
// uses, under a request context belonging to an org member.
//
// Unlike the O-003 blocks above, there is no worker/system context split
// here — O-006's writes are member-triggered directly (a candidate is
// recorded, a dismissal is clicked), so one org-member `TenantContext` plays
// both roles. The symmetry question is unchanged: did the write path stamp
// every column the scoped read filters by?
//
// Every repository/service method body under test is a Wave 0B typed stub
// that throws "not implemented" — every test below MUST fail for that
// reason today, never a compile error.
// ===========================================================================

/**
 * Builds a syntactically valid `SignatureHex` for fixture purposes only —
 * see the identical helper's comment in `cross-tenant.test.ts`. `hex.ts`'s
 * own constructors are themselves Wave 0B stubs, so nothing here can mint a
 * real digest yet; this file does not test `sha256Hex` itself.
 */
function fakeSignature(label: string): SignatureHex {
  return createHash("sha256").update(label).digest("hex") as unknown as SignatureHex;
}

describe("stamp/filter symmetry — the O-006 signature ledger tables", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- T-SS-1 (block 5) ------------------------------------------------------
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

    // The write path (D-9's atomic upsert).
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

    // The SAME scoped read `consultSignature` uses, under a request context
    // belonging to an org member — never a direct row read.
    const served = await createFindingSignaturesRepo(db, org.ctx).findBySignature(
      project.id,
      signature,
    );

    expect(served).not.toBeNull();
    // Every column the scoped read filters by (organization_id, project_id,
    // signature — D-10's row 1) must have been stamped by the write path, or
    // this comes back null and reads as "no data" rather than an error.
    expect(served?.organizationId).toBe(org.organizationId);
    expect(served?.projectId).toBe(project.id);
    expect(served?.signature).toBe(signature);
  });

  // --- T-SS-2 (block 6) ------------------------------------------------------
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

    // The write path — `recordDismissal`'s transaction (D-8).
    await createSignatureLedgerService(db, org.ctx).recordDismissal({
      projectId: project.id,
      findingId,
      signature,
      action: "not_useful",
      dismissedByUserId: org.userId,
    });

    // The SAME scoped read `consultSignature`'s suppression check uses.
    const served = await createDismissalsRepo(db, org.ctx).findFor(findingId, "not_useful");

    expect(served).not.toBeNull();
    // D-10's row 2: organization_id, finding_id, and action are FILTERED on;
    // project_id and signature are stamped but declared exempt from the
    // filter (kept for future per-project reads / the later FK). All five
    // must still be stamped by the write path.
    expect(served?.organizationId).toBe(org.organizationId);
    expect(served?.projectId).toBe(project.id);
    expect(served?.findingId).toBe(findingId);
    expect(served?.signature).toBe(signature);
    expect(served?.action).toBe("not_useful");
  });

  // --- T-SS-3 / T-DB-8 (block 7 — D-10's declared exemption) -----------------
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

    // The write path — `recordAncestry`'s transaction (D-3a, D-8).
    await createSignatureLedgerService(db, org.ctx).recordAncestry({
      projectId: project.id,
      oldSignature,
      newSignature,
      reason: "surface_rename",
    });

    // The SAME scoped read the forward walk uses — filtered by
    // (organization_id, old_signature) ONLY, never project_id (D-10's
    // declared exemption: project_id is already inside the hash, so one
    // old_signature cannot legitimately span two projects).
    const edge = await createSignatureAncestryRepo(db, org.ctx).forwardEdge(oldSignature);
    expect(edge).not.toBeNull();
    expect(edge?.newSignature).toBe(newSignature);

    // THE EXEMPTION'S REGRESSION TEST: project_id was stamped by the write
    // path even though the read above never named it as a filter.
    expect(edge?.projectId).toBe(project.id);

    const resolved = await createSignatureAncestryRepo(db, org.ctx).resolve(oldSignature);
    expect(resolved).toEqual({ resolution: "resolved", signature: newSignature, hops: 1 });
  });
});
