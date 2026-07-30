// Service tests for `createConnectionsService` — ADD §9 items 90–96, plus the
// seven-state expressibility O-008 depends on (Design Input) and the
// no-key-material bar of FR-7.
//
// Everything here runs against REAL SQL via `createTestDb()` and a FAKE
// source. The fake is possible at all because `createSource` is an injected
// dependency (D-11) — that injection is what keeps `packages/db` independent
// of `packages/adapters`, and this suite deliberately imports nothing from
// that package.
//
// WAVE 0: `createConnectionsService` is a typed stub that throws. Every test
// below MUST fail with "TYPED STUB (O-003 scaffold)" — never a compile error,
// a missing table, or a fixture collision.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  CONNECTION_STATE_MESSAGES,
  CONNECT_REFUSAL_MESSAGES,
  secondSourceRefusalMessage,
  type ConnectRefusalCode,
  type ConnectionState,
  type ConnectionStateStatus,
  type CredentialKeyResolution,
  type SourceFailureCode,
} from "@growthmind/shared";

import { createPollRunsRepo } from "../../src/repositories/poll-runs.repo";
import {
  createConnectionsService,
  type ConnectInput,
  type ConnectionsServiceDeps,
} from "../../src/services/connections.service";
import { createEventsCounterService } from "../../src/services/events-counter.service";
import { persistPullResult } from "../../src/services/intake.service";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedConnection } from "../helpers/fixtures";
import {
  FAKE_HOST,
  FAKE_PERSONAL_KEY,
  FAKE_PERSONAL_KEY_FORMS,
  FAKE_SOURCE_PROJECT_ID,
  KEY_MATERIAL_PATTERN,
  emptyPull,
  failedValidation,
  makeFakeSource,
  okValidation,
  pageCappedPull,
  sourceEvent,
  sourceSession,
  successfulPull,
  type FakeSourceHarness,
} from "./fake-source";
import { OWNER_EMAIL_DOMAIN, seedWorkspace, seedWorkspaceWithoutOwner } from "./seed";

const FIXED_NOW = new Date("2026-07-30T12:00:00.000Z");

/**
 * A resolved key made of 32 zero bytes. Obviously fake and unusable — this
 * repository is public — and enough to satisfy `CredentialKey`'s contract so
 * the service's own gate, not the fixture, is what the tests exercise.
 */
const RESOLVED_KEY: CredentialKeyResolution = { ok: true, key: { bytes: new Uint8Array(32) } };

/** What `resolveCredentialKey` returns in production under the published dev
 * default — the D-1 refusal the insecure-defaults bypass cannot open. */
const INSECURE_DEFAULT_KEY: CredentialKeyResolution = {
  ok: false,
  reason: "insecure_default_key",
};

function deps(
  harness: FakeSourceHarness,
  credentialKey: CredentialKeyResolution = RESOLVED_KEY,
): ConnectionsServiceDeps {
  return { createSource: harness.createSource, credentialKey, now: () => FIXED_NOW };
}

function connectInput(projectId: string, overrides: Partial<ConnectInput> = {}): ConnectInput {
  return {
    projectId,
    sourceKind: "posthog",
    host: FAKE_HOST,
    sourceProjectId: FAKE_SOURCE_PROJECT_ID,
    personalApiKey: FAKE_PERSONAL_KEY,
    ...overrides,
  };
}

describe("createConnectionsService — attach", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // --- item 90 -------------------------------------------------------------

  test("refuses a second source, naming the existing attachment and the cutover path", async () => {
    const ws = await seedWorkspace(db, "second-source");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const first = await service.connect(connectInput(ws.project.id));
    expect(first.ok).toBe(true);

    const second = await service.connect(
      connectInput(ws.project.id, {
        host: "https://us.analytics.example.invalid",
        sourceProjectId: "99999",
      }),
    );

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");

    expect(second.refusal.code).toBe("second_source");
    // The message names the EXISTING attachment, not the rejected one, so the
    // customer knows which one to detach.
    expect(second.refusal.message).toBe(
      secondSourceRefusalMessage({ host: FAKE_HOST, sourceProjectId: FAKE_SOURCE_PROJECT_ID }),
    );
    expect(second.refusal.message).toContain(FAKE_HOST);
    expect(second.refusal.message).toContain(FAKE_SOURCE_PROJECT_ID);
  });

  test("re-attaching the SAME source is an update, not a refusal — a rotated key is accepted", async () => {
    const ws = await seedWorkspace(db, "rekey");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const first = await service.connect(connectInput(ws.project.id));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    const rotatedKey = `${FAKE_PERSONAL_KEY}-rotated`;
    const again = await service.connect(
      connectInput(ws.project.id, { personalApiKey: rotatedKey }),
    );

    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("unreachable");
    // Same attachment, re-keyed — not a duplicate row and not a refusal.
    expect(again.connection.id).toBe(first.connection.id);
    // The ROTATED key is what was validated, proving the update reached the source.
    expect(harness.configs.at(-1)?.personalApiKey).toBe(rotatedKey);
  });

  test("leaves exactly one active attachment after a same-source re-attach", async () => {
    const ws = await seedWorkspace(db, "rekey-state");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    await service.connect(connectInput(ws.project.id));
    await service.connect(
      connectInput(ws.project.id, { personalApiKey: `${FAKE_PERSONAL_KEY}-2` }),
    );

    const state = await service.getState(ws.project.id);

    expect(state.status).not.toBe("not_connected");
    if (state.status === "not_connected") throw new Error("unreachable");
    expect(state.connection.isActive).toBe(true);
    expect(state.connection.sourceProjectId).toBe(FAKE_SOURCE_PROJECT_ID);
  });

  // --- item 91 -------------------------------------------------------------

  test("a validation failure never leaves an ACTIVE connection behind", async () => {
    const ws = await seedWorkspace(db, "no-active-on-fail");
    const harness = makeFakeSource({
      validation: failedValidation(FIXED_NOW, {
        code: "invalid_credentials",
        message: CONNECT_REFUSAL_MESSAGES.invalid_credentials,
      }),
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));
    expect(result.ok).toBe(false);

    // CR-13 fix: this used to read `if (state.status !== "not_connected") {
    // expect(...isActive).toBe(false) }` — but a NEW attach that fails
    // validation writes NOTHING (see the code comment above `refusalFor`'s
    // call site in connections.service.ts), so `state.status` is ALWAYS
    // `"not_connected"` here and that conditional's body never ran. Assert
    // the actual, always-true fact directly instead of a dead branch.
    const state = await service.getState(ws.project.id);
    expect(state.status).toBe("not_connected");
  });

  test("a validation failure on a RE-KEY marks the EXISTING connection failing, without deactivating it", async () => {
    // CR-13: the branch this covers (connections.service.ts's `if (isRekey
    // && existing) { recordHealth(... "failing" ...) }`, just above
    // `refusalFor`) had no test at all — every existing "validation failure"
    // test above exercises only a brand-new, never-attached project, which
    // can never take this branch (`isRekey` requires an existing active
    // connection on the SAME source).
    const ws = await seedWorkspace(db, "rekey-fail-health");
    const working = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(working));

    const first = await service.connect(connectInput(ws.project.id));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");

    // Same host/sourceProjectId/sourceKind as the first attach — `isSameSource`
    // routes this to the re-key branch rather than FR-8's second-source path.
    const failing = makeFakeSource({
      validation: failedValidation(FIXED_NOW, {
        code: "invalid_credentials",
        message: CONNECT_REFUSAL_MESSAGES.invalid_credentials,
      }),
    });
    const failingService = createConnectionsService(db, ws.ctx, deps(failing));
    const rekeyAttempt = await failingService.connect(connectInput(ws.project.id));

    expect(rekeyAttempt.ok).toBe(false);
    if (rekeyAttempt.ok) throw new Error("unreachable");
    expect(rekeyAttempt.refusal.code).toBe("invalid_credentials");

    const state = await service.getState(ws.project.id);
    expect(state.status).not.toBe("not_connected");
    if (state.status === "not_connected") throw new Error("unreachable");
    // The EXISTING attachment stays active — a bad re-key attempt must not
    // silently disconnect a connection that was working a moment ago — but
    // its health now reflects the failed check, terminally (never "validating").
    expect(state.connection.id).toBe(first.connection.id);
    expect(state.connection.isActive).toBe(true);
    expect(state.connection.health).toBe("failing");
    expect(state.connection.healthReasonCode).toBe("invalid_credentials");
    expect(state.connection.healthCheckedAt).not.toBeNull();
  });

  test("a validation failure records a TERMINAL state — never a stuck 'validating'", async () => {
    const ws = await seedWorkspace(db, "terminal-health");
    const harness = makeFakeSource({
      validation: failedValidation(FIXED_NOW, {
        code: "unreachable",
        message: CONNECT_REFUSAL_MESSAGES.unreachable,
      }),
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    await service.connect(connectInput(ws.project.id));

    const state = await service.getState(ws.project.id);

    // "validating" is a non-terminal state. A failed attach that persisted
    // anything must never park the customer there — that is the stuck-forever
    // shape the transparency rule exists to forbid.
    expect(state.status).not.toBe("validating");
    if (state.status !== "not_connected") {
      expect(["failing", "disconnected"]).toContain(state.connection.health);
      expect(state.connection.healthCheckedAt).not.toBeNull();
    }
  });

  test("a connection refused at validation does not block a later successful attach", async () => {
    const ws = await seedWorkspace(db, "retry-after-fail");
    const failing = makeFakeSource({
      validation: failedValidation(FIXED_NOW, {
        code: "invalid_credentials",
        message: CONNECT_REFUSAL_MESSAGES.invalid_credentials,
      }),
    });
    const failedService = createConnectionsService(db, ws.ctx, deps(failing));
    await failedService.connect(connectInput(ws.project.id));

    const working = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(working));
    const retry = await service.connect(connectInput(ws.project.id));

    // A broken half-written row would surface here as a `second_source`
    // refusal — the customer locked out of their own project by a typo.
    expect(retry.ok).toBe(true);
  });

  // --- item 92 -------------------------------------------------------------

  const FAILURE_CASES: ReadonlyArray<{ source: SourceFailureCode; refusal: ConnectRefusalCode }> = [
    { source: "invalid_credentials", refusal: "invalid_credentials" },
    { source: "project_not_found", refusal: "project_not_found" },
    { source: "unreachable", refusal: "unreachable" },
  ];

  for (const testCase of FAILURE_CASES) {
    test(`a ${testCase.source} validation refuses with the matching ${testCase.refusal} reason`, async () => {
      const ws = await seedWorkspace(db, `refuse-${testCase.source}`);
      const harness = makeFakeSource({
        validation: failedValidation(FIXED_NOW, {
          code: testCase.source,
          message: "a source-side message the service must not pass through",
        }),
      });
      const service = createConnectionsService(db, ws.ctx, deps(harness));

      // Resolving at all is part of the contract: a wrong key is an answer,
      // never a thrown exception at the boundary.
      const result = await service.connect(connectInput(ws.project.id));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.refusal.code).toBe(testCase.refusal);
      expect(result.refusal.message).toBe(CONNECT_REFUSAL_MESSAGES[testCase.refusal]);
    });
  }

  test("wrong-credentials, wrong-project and unreachable read as three different answers", async () => {
    const messages: string[] = [];
    const codes: ConnectRefusalCode[] = [];

    for (const testCase of FAILURE_CASES) {
      const ws = await seedWorkspace(db, `distinct-${testCase.source}`);
      const harness = makeFakeSource({
        validation: failedValidation(FIXED_NOW, {
          code: testCase.source,
          message: "source-side detail",
        }),
      });
      const service = createConnectionsService(db, ws.ctx, deps(harness));
      const result = await service.connect(connectInput(ws.project.id));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      codes.push(result.refusal.code);
      messages.push(result.refusal.message);
    }

    expect(new Set(codes).size).toBe(3);
    expect(new Set(messages).size).toBe(3);
  });

  test("a refusal is plain English — never a stack trace and never the source's own words", async () => {
    const ws = await seedWorkspace(db, "no-stack-trace");
    const harness = makeFakeSource({
      validation: failedValidation(FIXED_NOW, {
        code: "invalid_credentials",
        message:
          "Error: Personal API key found in request Authorization header is invalid\n    at validate (posthog/client.ts:42:11)",
      }),
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.message).not.toContain("Error:");
    expect(result.refusal.message).not.toContain("    at ");
    expect(result.refusal.message).not.toContain("Authorization");
  });

  test("no key material reaches the refusal or the persisted health reason, in ANY encoding", async () => {
    const ws = await seedWorkspace(db, "no-key-material");
    // A deliberately leaky source: it echoes the key back URL-encoded,
    // JSON-escaped and truncated. Exact-whole-string scrubbing misses all
    // three, which is exactly why FR-7's strengthening exists.
    const leaked = FAKE_PERSONAL_KEY_FORMS.join(" | ");
    const harness = makeFakeSource({
      validation: failedValidation(FIXED_NOW, {
        code: "invalid_credentials",
        message: `rejected key ${leaked}`,
      }),
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");

    const surfaces = [result.refusal.message];
    const state = await service.getState(ws.project.id);
    if (state.status !== "not_connected") {
      surfaces.push(state.connection.healthReasonMessage ?? "");
      expect(JSON.stringify(state.connection)).not.toContain("credential");
    }

    for (const surface of surfaces) {
      for (const form of FAKE_PERSONAL_KEY_FORMS) {
        expect(surface).not.toContain(form);
      }
      expect(KEY_MATERIAL_PATTERN.test(surface)).toBe(false);
    }
  });

  // --- item 93 -------------------------------------------------------------

  test("refuses with 'misconfigured' when the encryption key is the published default in production", async () => {
    const ws = await seedWorkspace(db, "misconfigured");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness, INSECURE_DEFAULT_KEY));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.refusal.code).toBe("misconfigured");
    expect(result.refusal.message).toBe(CONNECT_REFUSAL_MESSAGES.misconfigured);
  });

  test("a misconfigured installation writes no row and makes no source call at all", async () => {
    const ws = await seedWorkspace(db, "misconfigured-noop");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness, INSECURE_DEFAULT_KEY));

    await service.connect(connectInput(ws.project.id));

    expect(harness.configs).toHaveLength(0);
    expect(harness.validateCalls.count).toBe(0);

    const state = await service.getState(ws.project.id);
    expect(state.status).toBe("not_connected");
  });

  // --- item 94 / 95 --------------------------------------------------------

  test("infers the internal domain from the org creator's email and records its provenance", async () => {
    const ws = await seedWorkspace(db, "infer-domain");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.connection.inferredInternalDomain).toBe(OWNER_EMAIL_DOMAIN);
    expect(result.connection.internalDomainProvenance).toBe("org_creator_email");
  });

  test("infers NOTHING when the organization has no resolvable creator email", async () => {
    const ws = await seedWorkspaceWithoutOwner(db, "no-creator");
    const harness = makeFakeSource();
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // F-2: a missing creator email must never produce a guess. A wrong
    // internal domain silently excludes the customer's entire user base.
    expect(result.connection.inferredInternalDomain).toBeNull();
    expect(result.connection.internalDomainProvenance).toBeNull();
  });

  // --- item 96 -------------------------------------------------------------

  test("performs exactly ONE bounded inline first pull of ONE page", async () => {
    const ws = await seedWorkspace(db, "first-pull-bounds");
    const harness = makeFakeSource({
      pulls: [
        successfulPull({
          sessions: [sourceSession({ sessionKey: "ph:first-pull-1" })],
          events: [sourceEvent({ sourceEventId: "evt-first-1", sessionKey: "ph:first-pull-1" })],
        }),
      ],
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    await service.connect(connectInput(ws.project.id));

    expect(harness.pullRequests).toHaveLength(1);
    expect(harness.pullRequests[0]?.maxPages).toBe(1);
    // A brand-new attachment has never been polled.
    expect(harness.pullRequests[0]?.watermarkAt).toBeNull();
  });

  // --- CR-1 regression -------------------------------------------------------
  // First-connect backlog stall: a brand-new attachment (never polled, so
  // `watermarkAt` is null) whose inline first pull hits the page cap used to
  // record NEITHER `watermarkAt` NOR `backfillBefore` — `advanceWatermark`
  // needs a `Date` for `watermarkAt` and there was no watermark to hold
  // steady. This test MUST FAIL against the pre-fix code: `attached.
  // connection.backfillBefore` would be `null` instead of the resume cursor.

  test("CR-1: a page-capped inline first pull on a never-polled connection persists a resume cursor and does NOT advance the watermark", async () => {
    const ws = await seedWorkspace(db, "cr1-first-pull-backlog");
    const resumeCursor =
      "https://eu.analytics.example.invalid/api/projects/00000/events?before=cr1-resume-token";
    const harness = makeFakeSource({
      pulls: [
        pageCappedPull({
          sessions: [sourceSession({ sessionKey: "ph:cr1-backlog-1" })],
          events: [
            sourceEvent({ sourceEventId: "evt-cr1-backlog-1", sessionKey: "ph:cr1-backlog-1" }),
          ],
          resumeBefore: resumeCursor,
        }),
      ],
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // THE FIX: the resume cursor survives even though this connection has
    // never had a watermark.
    expect(result.connection.backfillBefore).toBe(resumeCursor);
    // The watermark invariant is preserved exactly as before the fix: a
    // page-capped walk must never advance it.
    expect(result.connection.watermarkAt).toBeNull();

    // Read back through the service's own state surface too, so the
    // assertion is not just on the in-memory return value.
    const state = await service.getState(ws.project.id);
    expect(state.status).not.toBe("not_connected");
    if (state.status === "not_connected") throw new Error("unreachable");
    expect(state.connection.backfillBefore).toBe(resumeCursor);
    expect(state.connection.watermarkAt).toBeNull();
  });

  test("the counter is non-zero the moment connect returns", async () => {
    const ws = await seedWorkspace(db, "first-pull-counter");
    const harness = makeFakeSource({
      pulls: [
        successfulPull({
          sessions: [sourceSession({ sessionKey: "ph:glue-1" })],
          events: [
            sourceEvent({ sourceEventId: "evt-glue-1", sessionKey: "ph:glue-1" }),
            sourceEvent({ sourceEventId: "evt-glue-2", sessionKey: "ph:glue-1" }),
          ],
        }),
      ],
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    const result = await service.connect(connectInput(ws.project.id));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.firstPullEventsSeen).toBe(2);

    // The glue moment is only real if the pull was PERSISTED, not just
    // returned — so it is read back through the counter service, the same
    // surface onboarding step 2 will read.
    const counter = await createEventsCounterService(db, ws.ctx).read(ws.project.id);
    expect(counter.totalReceived).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The seven states O-008 renders (Design Input). Every one must be expressible
// through the service, and no two may be the same answer.
// ---------------------------------------------------------------------------

const ALL_STATUSES: readonly ConnectionStateStatus[] = [
  "not_connected",
  "validating",
  "connected_never_polled",
  "connected_no_events_yet",
  "connected_receiving",
  "failing",
  "disconnected",
];

describe("createConnectionsService — the seven connection states", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function scenarioFor(status: ConnectionStateStatus): Promise<ConnectionState> {
    const ws = await seedWorkspace(db, `state-${status}`);
    const service = createConnectionsService(db, ws.ctx, deps(makeFakeSource()));

    if (status === "not_connected") {
      return service.getState(ws.project.id);
    }

    const connection = await seedConnection(db, {
      organizationId: ws.organizationId,
      projectId: ws.project.id,
      host: FAKE_HOST,
      sourceProjectId: FAKE_SOURCE_PROJECT_ID,
      isActive: status !== "disconnected",
      health:
        status === "validating"
          ? "validating"
          : status === "failing"
            ? "failing"
            : status === "disconnected"
              ? "disconnected"
              : "healthy",
      watermarkAt:
        status === "connected_never_polled" ? null : new Date("2026-07-30T11:30:00.000Z"),
    });

    const runs = createPollRunsRepo(db, ws.ctx);

    if (status === "connected_no_events_yet") {
      const run = await runs.start({
        projectId: ws.project.id,
        connectionId: connection.id,
        startedAt: new Date("2026-07-30T11:29:00.000Z"),
      });
      await runs.finish(run.id, {
        status: "completed",
        finishedAt: new Date("2026-07-30T11:30:00.000Z"),
        outcome: "no_new_events",
        watermarkAdvancedTo: null,
        eventsReceived: 0,
        eventsPersisted: 0,
        eventsDroppedMalformed: 0,
        sessionsTouched: 0,
        pagesFetched: 1,
        identityLookupsUsed: 0,
      });
    }

    if (status === "connected_receiving") {
      await persistPullResult(db, ws.ctx, {
        connection: {
          id: connection.id,
          projectId: ws.project.id,
          inferredInternalDomain: null,
        },
        result: successfulPull({
          sessions: [sourceSession({ sessionKey: "ph:receiving-1" })],
          events: [sourceEvent({ sourceEventId: "evt-receiving-1", sessionKey: "ph:receiving-1" })],
        }),
      });
      const run = await runs.start({
        projectId: ws.project.id,
        connectionId: connection.id,
        startedAt: new Date("2026-07-30T11:29:00.000Z"),
      });
      await runs.finish(run.id, {
        status: "completed",
        finishedAt: new Date("2026-07-30T11:30:00.000Z"),
        outcome: "with_events",
        watermarkAdvancedTo: new Date("2026-07-30T11:30:00.000Z"),
        eventsReceived: 1,
        eventsPersisted: 1,
        eventsDroppedMalformed: 0,
        sessionsTouched: 1,
        pagesFetched: 1,
        identityLookupsUsed: 0,
      });
    }

    return service.getState(ws.project.id);
  }

  for (const status of ALL_STATUSES) {
    test(`expresses the "${status}" state`, async () => {
      const state = await scenarioFor(status);
      expect(state.status).toBe(status);
    });
  }

  test("the seven states are pairwise distinguishable — distinct status, distinct message", async () => {
    const statuses: ConnectionStateStatus[] = [];
    for (const status of ALL_STATUSES) {
      const state = await scenarioFor(status);
      statuses.push(state.status);
    }

    expect(new Set(statuses).size).toBe(ALL_STATUSES.length);
    const messages = statuses.map((status) => CONNECTION_STATE_MESSAGES[status]);
    expect(new Set(messages).size).toBe(ALL_STATUSES.length);
  });

  test("no state message claims the data is live", async () => {
    for (const status of ALL_STATUSES) {
      const state = await scenarioFor(status);
      expect(CONNECTION_STATE_MESSAGES[state.status]).not.toMatch(/\blive\b/i);
    }
  });
});

describe("createConnectionsService — disconnect", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("disconnect returns the disconnected state and keeps everything already collected", async () => {
    const ws = await seedWorkspace(db, "disconnect");
    const harness = makeFakeSource({
      pulls: [
        successfulPull({
          sessions: [sourceSession({ sessionKey: "ph:kept-1" })],
          events: [sourceEvent({ sourceEventId: "evt-kept-1", sessionKey: "ph:kept-1" })],
        }),
        emptyPull(),
      ],
    });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    await service.connect(connectInput(ws.project.id));
    const state = await service.disconnect(ws.project.id);

    expect(state.status).toBe("disconnected");

    const counter = await createEventsCounterService(db, ws.ctx).read(ws.project.id);
    expect(counter.totalReceived).toBe(1);
  });

  test("validate is never called against a live host — the fake source is the only source", async () => {
    const ws = await seedWorkspace(db, "injection-proof");
    const harness = makeFakeSource({ validation: okValidation(FIXED_NOW) });
    const service = createConnectionsService(db, ws.ctx, deps(harness));

    await service.connect(connectInput(ws.project.id));

    // The injected factory received the config — proof the service never
    // constructs a vendor client of its own, which is what keeps
    // packages/db independent of packages/adapters.
    expect(harness.configs).toHaveLength(1);
    expect(harness.configs[0]?.host).toBe(FAKE_HOST);
    expect(harness.validateCalls.count).toBe(1);
  });
});
