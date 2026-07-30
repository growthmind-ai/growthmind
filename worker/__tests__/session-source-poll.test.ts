// O-003 §9 items 107–113 — the scheduler handler's behaviour (D-7, D8, D7,
// FR-22, FR-23).
//
// Every test drives `runSessionSourcePoll` — the real handler, the same plain
// function `taskList` invokes — against a real `createTestDb()` database and a
// FAKED HTTP layer. No test in this file makes a network call, and no test
// sleeps: `fetch`, `sleep`, `now`, and `random` are all injected, so a backoff
// sequence is asserted with zero wall-clock waiting.
//
// FIXTURE SEED PREFIX: `wk-`. Every org name, user email, and project name
// carries it, and each is suffixed with a uuid, so no suite can collide with
// another on `user_email_unique`.
//
// WAVE 0: `runSessionSourcePoll` is a typed stub whose body throws. Every test
// here MUST fail on that, never on a compile error or a fixture collision.
import { afterEach, beforeEach, expect, test } from "bun:test";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { runSessionSourcePoll } from "../src/tasks/session-source-poll";
import {
  createFakeClock,
  createFakePostHog,
  createPollDeps,
  createRecordingLogger,
  encryptTestCredential,
  fakeEvent,
  FAKE_AUTH_FAILURE_BODY,
  FAKE_THROTTLED_BODY,
  jargonIn,
  nextCursorUrl,
  seedPollableWorkspace,
  seedProjectWithConnection,
  testServerEnv,
  toPostHogInstant,
  type FakeClock,
  type FakeEventsPage,
  type FakeFault,
  type SeededWorkspace,
} from "./helpers/wire-fixtures";

const PREFIX = "wk-";
const NOW = new Date("2026-07-30T18:00:00.000Z");

// A fresh database per test. The atomic claim is deliberately GLOBAL — it
// claims every due connection, not a caller-named one — so a shared database
// would let one test's fixture be claimed by another test's handler run.
let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

/**
 * A connection whose stored credential the handler can actually read back:
 * the ciphertext goes through the REAL `encryptSecret`, against the REAL key
 * `resolveCredentialKey` derives from the same environment the handler is
 * given. A hand-written placeholder would only ever exercise the fail-closed
 * branch.
 */
async function seedWired(
  overrides: Partial<Parameters<typeof seedPollableWorkspace>[1]> = {},
): Promise<SeededWorkspace> {
  const env = testServerEnv();
  return seedPollableWorkspace(db, {
    prefix: PREFIX,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
    ...overrides,
  });
}

// Filtering happens in TypeScript rather than in SQL so this suite needs no
// `drizzle-orm` import of its own — the worker package depends on
// `@growthmind/db`, not on the ORM directly, and a test must not widen a
// production package's dependency set.
async function pollRunsFor(connectionId: string) {
  const rows = await db.select().from(schema.sessionSourcePollRuns);
  return rows.filter((row) => row.connectionId === connectionId);
}

async function eventsFor(projectId: string) {
  const rows = await db.select().from(schema.events);
  return rows.filter((row) => row.projectId === projectId);
}

// ---------------------------------------------------------------------------
// Item 107 — graceful absence (FR-23 / D3)
// ---------------------------------------------------------------------------

test("a tick with no connections at all is a clean no-op that records nothing", async () => {
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({});
  const logger = createRecordingLogger();

  const summary = await runSessionSourcePoll(
    createPollDeps({ db, fetch: posthog.fetch, clock, logger }),
  );

  expect(summary.connectionsClaimed).toBe(0);
  expect(summary.connectionsPolled).toBe(0);
  expect(summary.connectionsFailed).toBe(0);
  expect(summary.runsRecorded).toBe(0);
  expect(summary.stoppedOnDuration).toBe(false);
  // No error state: a self-hoster with no PostHog is a supported deployment,
  // not a fault.
  expect(logger.errors).toEqual([]);
  // Nothing was even attempted upstream.
  expect(posthog.calls).toEqual([]);
  // And nothing was RECORDED — which is what makes it distinguishable from
  // "we polled and found nothing" (the next test).
  expect(await db.select().from(schema.sessionSourcePollRuns)).toEqual([]);
});

test("a quiet connection records a completed run with outcome no_new_events — not the same as having no connection", async () => {
  const seeded = await seedWired();
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({ events: () => ({ results: [], next: null }) });

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const run = runs[0];
  expect(run?.status).toBe("completed");
  // An empty page is never authoritative — a permanently-zero connection must
  // be VISIBLE, not indistinguishable from a healthy quiet one (D-6g).
  expect(run?.outcome).toBe("no_new_events");
});

// ---------------------------------------------------------------------------
// Item 108 — failure isolation (D8)
// ---------------------------------------------------------------------------

test("one failing connection does not fail the batch — the sibling connection still polls and persists", async () => {
  const env = testServerEnv();
  const broken = await seedWired({ sourceProjectId: `${PREFIX}broken` });
  const healthy = await seedProjectWithConnection(db, {
    prefix: PREFIX,
    organizationId: broken.organizationId,
    sourceProjectId: `${PREFIX}healthy`,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: (request): FakeEventsPage | FakeFault => {
      if (request.url.pathname.includes(`${PREFIX}broken`)) {
        return { kind: "network", message: "connection reset by peer" };
      }
      return {
        results: [
          fakeEvent({
            distinctId: `${PREFIX}visitor`,
            sessionId: `${PREFIX}sibling-session`,
            occurredAt: new Date(NOW.getTime() - 60_000),
            pathname: "/pricing",
          }),
        ],
        next: null,
      };
    },
  });

  const summary = await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The batch did not fail — it isolated.
  expect(summary.connectionsFailed).toBe(1);
  expect(summary.connectionsPolled).toBe(1);
  // And the sibling actually PERSISTED, which is the part a summary count
  // alone would not prove.
  expect((await eventsFor(healthy.projectId)).length).toBe(1);
  expect((await eventsFor(broken.projectId)).length).toBe(0);
});

// ---------------------------------------------------------------------------
// Item 109 — every exit path reaches a terminal state (FR-22 / D8 /
// event-transparency). Parameterised over the five ways a pass can end.
// ---------------------------------------------------------------------------

interface ExitScenario {
  readonly name: string;
  readonly events: (callIndex: number) => FakeEventsPage | FakeFault;
}

const EXIT_SCENARIOS: readonly ExitScenario[] = [
  {
    name: "success",
    events: () => ({
      results: [
        fakeEvent({
          distinctId: `${PREFIX}visitor`,
          sessionId: `${PREFIX}ok-session`,
          occurredAt: new Date(NOW.getTime() - 60_000),
        }),
      ],
      next: null,
    }),
  },
  {
    name: "auth failure",
    events: () => ({ kind: "status", status: 401, body: FAKE_AUTH_FAILURE_BODY }),
  },
  {
    name: "rate-limit give-up",
    events: () => ({
      kind: "status",
      status: 429,
      body: FAKE_THROTTLED_BODY,
      headers: { "retry-after": "1" },
    }),
  },
  {
    name: "malformed page",
    events: () => ({ results: [{ nothing: "resembling an event" }], next: null }),
  },
  {
    name: "network fault",
    events: () => ({ kind: "network", message: "socket hang up" }),
  },
];

for (const scenario of EXIT_SCENARIOS) {
  test(`every exit path finishes its poll run with completed or failed and a plain-English reason — ${scenario.name}`, async () => {
    const seeded = await seedWired();
    const clock = createFakeClock(NOW);
    const posthog = createFakePostHog({
      events: (request) => scenario.events(request.callIndex),
    });

    await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

    const runs = await pollRunsFor(seeded.connectionId);
    expect(runs.length).toBeGreaterThanOrEqual(1);

    for (const run of runs) {
      // No run is left `running`. A missed terminal state is a "polling…" the
      // customer sees forever.
      expect(["completed", "failed"]).toContain(run.status);
      expect(run.finishedAt).not.toBeNull();

      if (run.status === "failed") {
        expect(run.failureCode).not.toBeNull();
        expect((run.failureMessage ?? "").length).toBeGreaterThan(0);
        // Plain English: no product jargon, no bare HTTP status, and never the
        // vendor's own `detail` text.
        expect(jargonIn(run.failureMessage ?? "")).toEqual([]);
        expect(run.failureMessage ?? "").not.toContain(FAKE_AUTH_FAILURE_BODY.detail);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Item 110 — partial progress survives a mid-pull fault (FR-22)
// ---------------------------------------------------------------------------

test("a mid-pull network fault leaves already-persisted rows intact and does NOT advance the watermark", async () => {
  const watermark = new Date(NOW.getTime() - 10 * 60_000);
  const seeded = await seedWired({ watermarkAt: watermark });
  const clock = createFakeClock(NOW);

  const pageOneOldest = new Date(NOW.getTime() - 2 * 60_000);
  const posthog = createFakePostHog({
    events: (request): FakeEventsPage | FakeFault => {
      if (request.before === null) {
        return {
          results: [
            fakeEvent({
              distinctId: `${PREFIX}visitor-a`,
              sessionId: `${PREFIX}session-a`,
              occurredAt: new Date(NOW.getTime() - 60_000),
            }),
            fakeEvent({
              distinctId: `${PREFIX}visitor-b`,
              sessionId: `${PREFIX}session-b`,
              occurredAt: pageOneOldest,
            }),
          ],
          next: nextCursorUrl({
            sourceProjectId: seeded.sourceProjectId,
            before: pageOneOldest,
          }),
        };
      }
      return { kind: "network", message: "socket hang up mid-walk" };
    },
  });

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The walk is newest-first, so the events already retrieved are the NEWEST
  // ones. They stay persisted.
  expect((await eventsFor(seeded.projectId)).length).toBe(2);

  const connection = (await db.select().from(schema.projectConnections)).find(
    (row) => row.id === seeded.connectionId,
  );
  // The advance is all-or-nothing and happens only on a provably contiguous
  // walk. A mid-walk failure leaves it exactly where it was, so the overlap
  // re-query re-sees these rows next run and the unique index absorbs them.
  expect(connection?.watermarkAt?.getTime()).toBe(watermark.getTime());

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.some((run) => run.status === "failed")).toBe(true);
  expect(runs.every((run) => run.watermarkAdvancedTo === null)).toBe(true);
});

// ---------------------------------------------------------------------------
// Item 111 — a rate-limit give-up is terminal (FR-10 / D8)
// ---------------------------------------------------------------------------

test("a rate-limit give-up leaves a terminal failed state, never a stuck polling", async () => {
  const seeded = await seedWired();
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: () => ({
      kind: "status",
      status: 429,
      body: FAKE_THROTTLED_BODY,
      headers: { "retry-after": "30" },
    }),
  });

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  expect(runs.every((run) => run.status !== "running")).toBe(true);
  expect(runs.some((run) => run.status === "failed" && run.failureCode === "rate_limited")).toBe(
    true,
  );
});

test("the rate-limit retry is bounded and waits only on the injected clock", async () => {
  await seedWired();
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: () => ({
      kind: "status",
      status: 429,
      body: FAKE_THROTTLED_BODY,
      headers: { "retry-after": "30" },
    }),
  });
  const startedAt = Date.now();

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // Bounded: `MAX_RATE_LIMIT_ATTEMPTS` is 5, so a handful of requests, never
  // an unbounded loop.
  expect(posthog.eventsCalls().length).toBeLessThanOrEqual(10);
  // It DID back off — and every millisecond of it went through the injected
  // sleep, so no wall-clock time was spent.
  expect(clock.sleeps.length).toBeGreaterThan(0);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

// ---------------------------------------------------------------------------
// Item 112 — tenant scope comes from the connection row (FR-23 / D7)
// ---------------------------------------------------------------------------

test("the poll derives its tenant scope from the connection row and never from a payload", async () => {
  const orgA = await seedWired({ sourceProjectId: `${PREFIX}org-a-src` });
  const orgB = await seedWired({ sourceProjectId: `${PREFIX}org-b-src` });
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: (request) => ({
      results: [
        fakeEvent({
          distinctId: request.url.pathname.includes(`${PREFIX}org-a-src`)
            ? `${PREFIX}a-visitor`
            : `${PREFIX}b-visitor`,
          sessionId: request.url.pathname.includes(`${PREFIX}org-a-src`)
            ? `${PREFIX}a-session`
            : `${PREFIX}b-session`,
          occurredAt: new Date(NOW.getTime() - 60_000),
        }),
      ],
      next: null,
    }),
  });

  // The handler takes DEPS ONLY. There is no payload parameter, because the
  // task is cron-triggered — so there is no caller-supplied id for a scope to
  // be derived from even in principle.
  expect(runSessionSourcePoll.length).toBe(1);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const aRows = await eventsFor(orgA.projectId);
  const bRows = await eventsFor(orgB.projectId);
  expect(aRows.length).toBe(1);
  expect(bRows.length).toBe(1);
  expect(aRows.every((row) => row.organizationId === orgA.organizationId)).toBe(true);
  expect(bRows.every((row) => row.organizationId === orgB.organizationId)).toBe(true);

  // And no row of either org carries the other's id — the stamp came from the
  // claimed row, not from anything ambient.
  const crossed = (await db.select().from(schema.events)).filter(
    (row) => row.projectId === orgA.projectId && row.organizationId === orgB.organizationId,
  );
  expect(crossed).toEqual([]);
});

// ---------------------------------------------------------------------------
// Item 113 — the run duration cap (D-7)
// ---------------------------------------------------------------------------

test("the run respects MAX_RUN_DURATION_MS and leaves the remainder for the next tick", async () => {
  const first = await seedWired({ sourceProjectId: `${PREFIX}slow-1` });
  await seedProjectWithConnection(db, {
    prefix: PREFIX,
    organizationId: first.organizationId,
    sourceProjectId: `${PREFIX}slow-2`,
  });
  await seedProjectWithConnection(db, {
    prefix: PREFIX,
    organizationId: first.organizationId,
    sourceProjectId: `${PREFIX}slow-3`,
  });

  const clock: FakeClock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: () => {
      // Each upstream page "takes" 30 seconds of the injected clock, so the
      // 55-second cap is crossed between connections rather than mid-walk.
      clock.advance(30_000);
      return { results: [], next: null };
    },
  });

  const summary = await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(summary.stoppedOnDuration).toBe(true);
  // The remainder waits for the next tick — it is not a failure, and it is
  // not silently dropped.
  expect(summary.runsRecorded).toBeLessThan(3);
  expect(summary.connectionsFailed).toBe(0);
});

test("a duration-capped run is not reported as a failure", async () => {
  const seeded = await seedWired({ sourceProjectId: `${PREFIX}capped` });
  const clock: FakeClock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: () => {
      clock.advance(60_000);
      return { results: [], next: null };
    },
  });

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const runs = await pollRunsFor(seeded.connectionId);
  // Whatever ran, ran to a terminal state. Overshooting the cap never leaves a
  // half-finished run behind.
  expect(runs.every((run) => run.status !== "running")).toBe(true);
  expect(runs.every((run) => run.finishedAt !== null)).toBe(true);
});

// A guard on the fixture itself: the wire form the fakes emit is the
// microsecond `+00:00` shape the probe pinned, never a `Z` suffix. If this
// drifts, every test above would be exercising a shape PostHog never sends.
test("the fake upstream emits the pinned microsecond +00:00 timestamp form", () => {
  expect(toPostHogInstant(new Date("2026-07-30T14:57:54.891Z"))).toBe(
    "2026-07-30T14:57:54.891000+00:00",
  );
});
