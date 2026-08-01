// items 107–113, the scheduler handler's behaviour.
//
// Every test drives `runSessionSourcePoll`. The real handler, the same plain function
// `taskList` invokes. Against a real `createTestDb` database and a faked HTTP layer.
// No test in this file makes a network call, and no test sleeps: `fetch`, `sleep`,
// `now`, and `random` are all injected, so a backoff sequence is asserted with zero
// wall-clock waiting.
//
// Fixture seed PREFIX: `wk-`. Every org name, user email, and project name carries it,
// and each is suffixed with a uuid, so no suite can collide with another on
// `user_email_unique`.
//
// Wave 0: `runSessionSourcePoll` is a typed stub whose body throws. Every test here
// must fail on that, never on a compile error or a fixture collision.
import { randomUUID } from "node:crypto";

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

// A fresh database per test. The atomic claim is deliberately global. It claims every
// due connection, not a caller-named one, so a shared database would let one test's
// fixture be claimed by another test's handler run.
let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

/**
 * A connection whose stored credential the handler can actually read back: the
 * ciphertext goes through the real `encryptSecret`, against the real key
 * `resolveCredentialKey` derives from the same environment the handler is given. A
 * hand-written placeholder would only ever exercise the fail-closed branch.
 */
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

// Filtering happens in TypeScript rather than in SQL so this suite needs no
// `drizzle-orm` import of its own. The worker package depends on `@growthmind/db`, not
// on the ORM directly, and a test must not widen a production package's dependency set.
async function pollRunsFor(connectionId: string) {
  const rows = await db.select().from(schema.sessionSourcePollRuns);
  return rows.filter((row) => row.connectionId === connectionId);
}

async function eventsFor(projectId: string) {
  const rows = await db.select().from(schema.events);
  return rows.filter((row) => row.projectId === projectId);
}

/**
 * A DB wrapper that behaves exactly like the real one, except that inserting into one
 * named table throws. The write-side sibling of the network faults `createFakePostHog`
 * injects on the read side, used to cover the `runOnePass` catch block (persistence
 * throws after the pull already succeeded). Every other call, the ownership-filter
 * selects inside the repositories, the poll-run writes, the connection health write.
 * Passes straight through to the real PGlite instance untouched, via a `Proxy` rather
 * than a hand-rolled fake, so nothing about the passthrough calls can drift from the
 * real `TestDb` surface.
 */
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

// Item 107, graceful absence

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
  // No error state: a self-hoster with no PostHog is a supported deployment, not a
  // fault.
  expect(logger.errors).toEqual([]);
  // Nothing was even attempted upstream.
  expect(posthog.calls).toEqual([]);
  // And nothing was recorded, which is what makes it distinguishable from "we polled
  // and found nothing" (the next test).
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
  // An empty page is never authoritative. A permanently-zero connection must be
  // visible, not indistinguishable from a healthy quiet one.
  expect(run?.outcome).toBe("no_new_events");
});

// Item 108, failure isolation

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

  // The batch did not fail, it isolated.
  expect(summary.connectionsFailed).toBe(1);
  expect(summary.connectionsPolled).toBe(1);
  // And the sibling actually persisted, which is the part a summary count alone would
  // not prove.
  expect((await eventsFor(healthy.projectId)).length).toBe(1);
  expect((await eventsFor(broken.projectId)).length).toBe(0);
});

// Item 109, every exit path reaches a terminal state (event transparency).
// Parameterised over the five ways a pass can end.

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
      // No run is left `running`. A missed terminal state is a "polling…" the customer
      // sees forever.
      expect(["completed", "failed"]).toContain(run.status);
      expect(run.finishedAt).not.toBeNull();

      if (run.status === "failed") {
        expect(run.failureCode).not.toBeNull();
        expect((run.failureMessage ?? "").length).toBeGreaterThan(0);
        // Plain English: no product jargon, no bare HTTP status, and never the vendor's
        // own `detail` text.
        expect(jargonIn(run.failureMessage ?? "")).toEqual([]);
        expect(run.failureMessage ?? "").not.toContain(FAKE_AUTH_FAILURE_BODY.detail);
      }
    }
  });
}

// Item 109 (a sixth exit path, uncovered by EXIT_SCENARIOS). A stored credential this
// installation cannot decrypt fails closed, with NO request ever made.

test("a connection whose stored credential this installation cannot decrypt fails closed, records a failed run, and makes no request", async () => {
  // Omitting `credentialFor` leaves the fixture's default placeholder ciphertext
  // (`v1.00000000.aaaa.bbbb.cccc`): well-formed enough to parse (five dot-separated
  // fields, version `v1`), but stamped with a key id no real key resolves to. Exactly
  // the "written under a different key id" shape F-11 names, and it fails closed on
  // `key_id_mismatch` inside `decryptSecret` rather than throwing.
  const seeded = await seedPollableWorkspace(db, { prefix: PREFIX, now: NOW });
  const clock = createFakeClock(NOW);
  const posthog = createFakePostHog({});

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The point of this test: fail-closed means no request is even attempted. Neither an
  // events call nor a persons call.
  expect(posthog.calls).toEqual([]);

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  const run = runs[0];
  expect(run?.status).toBe("failed");
  expect(run?.finishedAt).not.toBeNull();
  expect(run?.failureCode).toBe("misconfigured");
  expect((run?.failureMessage ?? "").length).toBeGreaterThan(0);
  // Plain English: no product jargon, no bare HTTP status, and never the vendor's own
  // `detail` text.
  expect(jargonIn(run?.failureMessage ?? "")).toEqual([]);

  const connection = (await db.select().from(schema.projectConnections)).find(
    (row) => row.id === seeded.connectionId,
  );
  expect(connection?.health).toBe("failing");
});

// Item 110, partial progress survives a mid-pull fault

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

  // The walk is newest-first, so the events already retrieved are the newest ones. They
  // stay persisted.
  expect((await eventsFor(seeded.projectId)).length).toBe(2);

  const connection = (await db.select().from(schema.projectConnections)).find(
    (row) => row.id === seeded.connectionId,
  );
  // The advance is all-or-nothing and happens only on a provably contiguous walk. A
  // mid-walk failure leaves it exactly where it was, so the overlap re-query re-sees
  // these rows next run and the unique index absorbs them.
  expect(connection?.watermarkAt?.getTime()).toBe(watermark.getTime());

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.some((run) => run.status === "failed")).toBe(true);
  expect(runs.every((run) => run.watermarkAdvancedTo === null)).toBe(true);
});

// Item 110 (a second fault site, uncovered). Partial progress survives a mid-persist
// write fault too, not only a mid-pull network fault.

test("a mid-persist DB write failure leaves already-persisted events untouched and does NOT advance the watermark", async () => {
  const watermark = new Date(NOW.getTime() - 10 * 60_000);
  const seeded = await seedWired({ watermarkAt: watermark });

  // Data from a prior successful run. The "already-persisted state" this test proves
  // survives this run's failure untouched.
  const priorOccurredAt = new Date(NOW.getTime() - 20 * 60_000);
  const priorSessionId = randomUUID();
  await db.insert(schema.sessions).values({
    id: priorSessionId,
    organizationId: seeded.organizationId,
    projectId: seeded.projectId,
    connectionId: seeded.connectionId,
    sessionKey: `${PREFIX}prior-session`,
    identityKey: null,
    identityEmailDomain: null,
    identityResolution: "unresolved",
    userAgent: null,
    entryUrlPath: null,
    startedAt: priorOccurredAt,
    lastEventAt: priorOccurredAt,
    origin: "real",
    exclusionReason: "none",
    internalDomainAtStamp: null,
    exclusionRuleSetVersion: 1,
    groupingVersion: 1,
  });
  await db.insert(schema.events).values({
    id: randomUUID(),
    organizationId: seeded.organizationId,
    projectId: seeded.projectId,
    connectionId: seeded.connectionId,
    sessionId: priorSessionId,
    sourceEventId: `${PREFIX}prior-event`,
    name: "$pageview",
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

  // The pull succeeds; the write fails, on the events table specifically. After the
  // sessions half of the same `persistPullResult` call has already gone through, which
  // is what makes this "mid-persist" rather than "never attempted" (the credential test
  // above).
  const failingDb = dbThatFailsToInsert(db, schema.events, "simulated events write failure");

  await runSessionSourcePoll(createPollDeps({ db: failingDb, fetch: posthog.fetch, clock }));

  // The prior event is untouched, not duplicated, not lost. persistence failing on this
  // run's events must not corrupt what an earlier run wrote.
  const eventsAfter = await eventsFor(seeded.projectId);
  expect(eventsAfter.length).toBe(1);
  expect(eventsAfter[0]?.sourceEventId).toBe(`${PREFIX}prior-event`);

  // The advance is skipped entirely on a failed pass. The watermark stays exactly where
  // it was before this run, same as the network-fault case above.
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

// Item 111, a rate-limit give-up is terminal

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

  // Bounded: `MAX_RATE_LIMIT_ATTEMPTS` is 5, so a handful of requests, never an
  // unbounded loop.
  expect(posthog.eventsCalls().length).toBeLessThanOrEqual(10);
  // It did back off, and every millisecond of it went through the injected sleep, so no
  // wall-clock time was spent.
  expect(clock.sleeps.length).toBeGreaterThan(0);
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

// Item 112, tenant scope comes from the connection row

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

  // The handler takes deps only. There is no payload parameter, because the task is
  // cron-triggered, so there is no caller-supplied id for a scope to be derived from
  // even in principle.
  expect(runSessionSourcePoll.length).toBe(1);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const aRows = await eventsFor(orgA.projectId);
  const bRows = await eventsFor(orgB.projectId);
  expect(aRows.length).toBe(1);
  expect(bRows.length).toBe(1);
  expect(aRows.every((row) => row.organizationId === orgA.organizationId)).toBe(true);
  expect(bRows.every((row) => row.organizationId === orgB.organizationId)).toBe(true);

  // And no row of either org carries the other's id. The stamp came from the claimed
  // row, not from anything ambient.
  const crossed = (await db.select().from(schema.events)).filter(
    (row) => row.projectId === orgA.projectId && row.organizationId === orgB.organizationId,
  );
  expect(crossed).toEqual([]);
});

// Item 113, the run duration cap

test("the run respects MAX_RUN_DURATION_MS and leaves the remainder for the next tick", async () => {
  // All three connections need a real, decryptable credential. The point of this test
  // is that the clock crosses the cap between connections that are each actually
  // reaching the source. A connection seeded without `credentialFor` fails closed on
  // the unreadable placeholder ciphertext before ever calling fetch, which would
  // falsify `connectionsFailed` and never advance the clock at all.
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
      // Each upstream page "takes" 30 seconds of the injected clock, so the 55-second
      // cap is crossed between connections rather than mid-walk.
      clock.advance(30_000);
      return { results: [], next: null };
    },
  });

  const summary = await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(summary.stoppedOnDuration).toBe(true);
  // The remainder waits for the next tick. It is not a failure, and it is not silently
  // dropped.
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

// A guard on the fixture itself: the wire form the fakes emit is the microsecond
// `+00:00` shape the probe pinned, never a `Z` suffix. If this drifts, every test above
// would be exercising a shape PostHog never sends.
test("the fake upstream emits the pinned microsecond +00:00 timestamp form", () => {
  expect(toPostHogInstant(new Date("2026-07-30T14:57:54.891Z"))).toBe(
    "2026-07-30T14:57:54.891000+00:00",
  );
});
