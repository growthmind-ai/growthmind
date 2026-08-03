import { afterEach, beforeEach, expect, test } from "bun:test";

import { schema } from "@growthmind/db";
import { createTestDb, seedEvent, seedSession, type TestDb } from "@growthmind/db/testing";

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

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

async function seedWired(
  overrides: Partial<Parameters<typeof seedPollableWorkspace>[1]> = {},
): Promise<SeededWorkspace> {
  const env = testServerEnv();
  return seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
    ...overrides,
  });
}

async function pollRunsFor(connectionId: string) {
  const rows = await db.select().from(schema.sessionSourcePollRuns);
  return rows.filter((row) => row.connectionId === connectionId);
}

async function eventsFor(projectId: string) {
  const rows = await db.select().from(schema.events);
  return rows.filter((row) => row.projectId === projectId);
}

function dbThatFailsToInsert(realDb: TestDb, table: unknown, message: string): TestDb {
  const handler: ProxyHandler<TestDb> = {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return (arg: unknown) => {
          if (arg === table) {
            throw new Error(message);
          }
          const original = Reflect.get(target, prop, receiver) as (arg: unknown) => unknown;
          return original.call(target, arg);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  };
  return new Proxy(realDb, handler);
}

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

  expect(logger.errors).toEqual([]);

  expect(posthog.calls).toEqual([]);

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

  expect(run?.outcome).toBe("no_new_events");
});

test("one failing connection does not fail the batch — the sibling connection still polls and persists", async () => {
  const env = testServerEnv();
  const broken = await seedWired({ sourceProjectId: `${PREFIX}broken` });
  const healthy = await seedProjectWithConnection(db, {
    prefix: PREFIX,
    now: NOW,
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

  expect(summary.connectionsFailed).toBe(1);
  expect(summary.connectionsPolled).toBe(1);

  expect((await eventsFor(healthy.projectId)).length).toBe(1);
  expect((await eventsFor(broken.projectId)).length).toBe(0);
});

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
      expect(["completed", "failed"]).toContain(run.status);
      expect(run.finishedAt).not.toBeNull();

      if (run.status === "failed") {
        expect(run.failureCode).not.toBeNull();
        expect((run.failureMessage ?? "").length).toBeGreaterThan(0);

        expect(jargonIn(run.failureMessage ?? "")).toEqual([]);
        expect(run.failureMessage ?? "").not.toContain(FAKE_AUTH_FAILURE_BODY.detail);
      }
    }
  });
}

test("a connection whose stored credential this installation cannot decrypt fails closed, records a failed run, and makes no request", async () => {
  const seeded = await seedPollableWorkspace(db, { prefix: PREFIX, now: NOW });
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({});

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(posthog.calls).toEqual([]);

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const run = runs[0];
  expect(run?.status).toBe("failed");
  expect(run?.finishedAt).not.toBeNull();
  expect(run?.failureCode).toBe("misconfigured");
  expect((run?.failureMessage ?? "").length).toBeGreaterThan(0);

  expect(jargonIn(run?.failureMessage ?? "")).toEqual([]);

  const connection = (await db.select().from(schema.projectConnections)).find(
    (row) => row.id === seeded.connectionId,
  );
  expect(connection?.health).toBe("failing");
});

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

  expect((await eventsFor(seeded.projectId)).length).toBe(2);

  const connection = (await db.select().from(schema.projectConnections)).find(
    (row) => row.id === seeded.connectionId,
  );

  expect(connection?.watermarkAt?.getTime()).toBe(watermark.getTime());

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.some((run) => run.status === "failed")).toBe(true);
  expect(runs.every((run) => run.watermarkAdvancedTo === null)).toBe(true);
});

test("a mid-persist DB write failure leaves already-persisted events untouched and does NOT advance the watermark", async () => {
  const watermark = new Date(NOW.getTime() - 10 * 60_000);
  const seeded = await seedWired({ watermarkAt: watermark });

  const priorOccurredAt = new Date(NOW.getTime() - 20 * 60_000);
  const priorSession = await seedSession(db, {
    organizationId: seeded.organizationId,
    projectId: seeded.projectId,
    connectionId: seeded.connectionId,
    sessionKey: `${PREFIX}prior-session`,
    startedAt: priorOccurredAt,
    lastEventAt: priorOccurredAt,
  });
  await seedEvent(db, {
    organizationId: seeded.organizationId,
    projectId: seeded.projectId,
    connectionId: seeded.connectionId,
    sessionId: priorSession.id,
    sourceEventId: `${PREFIX}prior-event`,
    occurredAt: priorOccurredAt,
    urlPath: "/prior",
  });

  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: () => ({
      results: [
        fakeEvent({
          distinctId: `${PREFIX}visitor-fail`,
          sessionId: `${PREFIX}session-fail`,
          occurredAt: new Date(NOW.getTime() - 60_000),
        }),
      ],
      next: null,
    }),
  });

  const failingDb = dbThatFailsToInsert(db, schema.events, "simulated events write failure");

  await runSessionSourcePoll(createPollDeps({ db: failingDb, fetch: posthog.fetch, clock }));

  const eventsAfter = await eventsFor(seeded.projectId);
  expect(eventsAfter.length).toBe(1);
  expect(eventsAfter[0]?.sourceEventId).toBe(`${PREFIX}prior-event`);

  const connection = (await db.select().from(schema.projectConnections)).find(
    (row) => row.id === seeded.connectionId,
  );
  expect(connection?.watermarkAt?.getTime()).toBe(watermark.getTime());
  expect(connection?.health).toBe("failing");

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const run = runs[runs.length - 1];
  expect(run?.status).toBe("failed");
  expect(run?.finishedAt).not.toBeNull();
  expect((run?.failureMessage ?? "").length).toBeGreaterThan(0);
  expect(jargonIn(run?.failureMessage ?? "")).toEqual([]);
});

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

  expect(posthog.eventsCalls().length).toBeLessThanOrEqual(10);

  expect(clock.sleeps.length).toBeGreaterThan(0);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

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

  expect(runSessionSourcePoll.length).toBe(1);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const aRows = await eventsFor(orgA.projectId);
  const bRows = await eventsFor(orgB.projectId);
  expect(aRows.length).toBe(1);
  expect(bRows.length).toBe(1);
  expect(aRows.every((row) => row.organizationId === orgA.organizationId)).toBe(true);
  expect(bRows.every((row) => row.organizationId === orgB.organizationId)).toBe(true);

  const crossed = (await db.select().from(schema.events)).filter(
    (row) => row.projectId === orgA.projectId && row.organizationId === orgB.organizationId,
  );
  expect(crossed).toEqual([]);
});

test("the run respects MAX_RUN_DURATION_MS and leaves the remainder for the next tick", async () => {
  const env = testServerEnv();
  const first = await seedWired({ sourceProjectId: `${PREFIX}slow-1` });
  await seedProjectWithConnection(db, {
    prefix: PREFIX,
    now: NOW,
    organizationId: first.organizationId,
    sourceProjectId: `${PREFIX}slow-2`,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });
  await seedProjectWithConnection(db, {
    prefix: PREFIX,
    now: NOW,
    organizationId: first.organizationId,
    sourceProjectId: `${PREFIX}slow-3`,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const clock: FakeClock = createFakeClock(NOW);
  const posthog = createFakePostHog({
    events: () => {
      clock.advance(30_000);
      return { results: [], next: null };
    },
  });

  const summary = await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(summary.stoppedOnDuration).toBe(true);

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

  expect(runs.every((run) => run.status !== "running")).toBe(true);
  expect(runs.every((run) => run.finishedAt !== null)).toBe(true);
});

test("the fake upstream emits the pinned microsecond +00:00 timestamp form", () => {
  expect(toPostHogInstant(new Date("2026-07-30T14:57:54.891Z"))).toBe(
    "2026-07-30T14:57:54.891000+00:00",
  );
});
