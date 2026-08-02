import { afterEach, beforeEach, expect, test } from "bun:test";

import { createPostHogSessionSource } from "@growthmind/adapters";
import { createConnectionsService, schema, type ConnectInput } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";
import { deriveIdentityHmacKey, resolveCredentialKey } from "@growthmind/shared";

import { runSessionSourcePoll } from "../src/tasks/session-source-poll";
import {
  createFakeClock,
  createFakePostHog,
  createPollDeps,
  encryptTestCredential,
  fakeEvent,
  nextCursorUrl,
  seedPollableWorkspace,
  testServerEnv,
  type FakeEventsPage,
  type FakeEventsRequest,
} from "./helpers/wire-fixtures";

const PREFIX = "bf-";
const NOW = new Date("2026-07-30T18:00:00.000Z");

const EXPECTED_PAGE_CAP = 25;

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

function infiniteBacklog(sourceProjectId: string) {
  return (request: FakeEventsRequest): FakeEventsPage => {
    const idx = request.callIndex;
    return {
      results: [
        fakeEvent({
          id: `${PREFIX}evt-${idx}`,
          distinctId: `${PREFIX}visitor-${idx}`,
          sessionId: `${PREFIX}session-${idx}`,
          occurredAt: new Date(NOW.getTime() - (idx + 1) * 60_000),
          pathname: "/",
        }),
      ],
      next: nextCursorUrl({
        sourceProjectId,
        before: new Date(NOW.getTime() - (idx + 2) * 60_000),
      }),
    };
  };
}

async function connectionRow(connectionId: string) {
  const rows = await db.select().from(schema.projectConnections);
  return rows.find((row) => row.id === connectionId);
}

async function pollRunsFor(connectionId: string) {
  const rows = await db.select().from(schema.sessionSourcePollRuns);
  return rows.filter((row) => row.connectionId === connectionId);
}

test("a never-polled connection whose first walk hits the page cap persists a resume cursor and does NOT advance the watermark", async () => {
  const env = testServerEnv();
  const seeded = await seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,

    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const before = await connectionRow(seeded.connectionId);
  expect(before?.watermarkAt).toBeNull();
  expect(before?.backfillBefore).toBeNull();

  const posthog = createFakePostHog({ events: infiniteBacklog(seeded.sourceProjectId) });
  const clock = createFakeClock(NOW);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(posthog.eventsCalls().length).toBe(EXPECTED_PAGE_CAP);

  const after = await connectionRow(seeded.connectionId);

  expect(after?.backfillBefore).not.toBeNull();
  expect(after?.backfillBefore).toEqual(expect.stringContaining("before="));

  expect(after?.watermarkAt).toBeNull();

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  expect(runs.every((run) => run.status === "completed")).toBe(true);
  expect(runs.every((run) => run.watermarkAdvancedTo === null)).toBe(true);
});

test("the persisted resume cursor is actually consumed on the next tick — the backlog drains instead of re-fetching the same slice forever", async () => {
  const env = testServerEnv();
  const seeded = await seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const posthog = createFakePostHog({ events: infiniteBacklog(seeded.sourceProjectId) });
  const clock = createFakeClock(NOW);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));
  const afterFirst = await connectionRow(seeded.connectionId);
  const firstCursor = afterFirst?.backfillBefore ?? null;
  expect(firstCursor).not.toBeNull();
  const firstCallCount = posthog.eventsCalls().length;

  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(posthog.eventsCalls().length).toBeGreaterThan(firstCallCount);

  const afterSecond = await connectionRow(seeded.connectionId);
  expect(afterSecond?.watermarkAt).toBeNull();
  expect(afterSecond?.backfillBefore).not.toBeNull();
});

async function eventsFor(projectId: string) {
  const rows = await db.select().from(schema.events);
  return rows.filter((row) => row.projectId === projectId);
}

function positionalBacklog(params: {
  sourceProjectId: string;

  eventTimes: readonly Date[];
}) {
  return (request: FakeEventsRequest): FakeEventsPage => {
    const beforeMs = request.before !== null ? Date.parse(request.before) : null;
    const afterMs = request.after !== null ? Date.parse(request.after) : null;
    const remaining = params.eventTimes.filter((t) => {
      if (beforeMs !== null && !(t.getTime() < beforeMs)) return false;
      if (afterMs !== null && !(t.getTime() > afterMs)) return false;
      return true;
    });

    const page = remaining.slice(0, 1);
    const oldestOnPage = page[page.length - 1];
    const next =
      oldestOnPage !== undefined && remaining.length > page.length
        ? nextCursorUrl({ sourceProjectId: params.sourceProjectId, before: oldestOnPage })
        : null;
    return {
      results: page.map((occurredAt) =>
        fakeEvent({
          id: `${PREFIX}evt-${occurredAt.getTime()}`,
          distinctId: `${PREFIX}visitor-${occurredAt.getTime()}`,
          sessionId: `${PREFIX}session-${occurredAt.getTime()}`,
          occurredAt,
          pathname: "/",
        }),
      ),
      next,
    };
  };
}

test("a walk that stops with contiguous:false AND resumeBefore:null (the adapter's zero-budget case) still clears the stale cursor instead of livelocking forever", async () => {
  const eventTimes = Array.from(
    { length: 26 },
    (_, i) => new Date(NOW.getTime() - (i + 1) * 60_000),
  );
  const env = testServerEnv();

  const fixedSourceProjectId = `${PREFIX}src-cr3-livelock`;
  const originalSeedCursor = nextCursorUrl({
    sourceProjectId: fixedSourceProjectId,
    before: eventTimes[0]!,
  });
  const seeded = await seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    sourceProjectId: fixedSourceProjectId,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
    backfillBefore: originalSeedCursor,
  });

  const posthog = createFakePostHog({
    events: positionalBacklog({ sourceProjectId: seeded.sourceProjectId, eventTimes }),
  });
  const clock = createFakeClock(NOW);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(posthog.eventsCalls().length).toBe(25);

  const afterTickA = await connectionRow(seeded.connectionId);
  expect(afterTickA?.watermarkAt).toBeNull();

  expect(afterTickA?.backfillBefore).toBeNull();

  const runsAfterTickA = await pollRunsFor(seeded.connectionId);
  expect(runsAfterTickA.every((run) => run.status === "completed")).toBe(true);

  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const afterTickB = await connectionRow(seeded.connectionId);

  expect(afterTickB?.backfillBefore).not.toBeNull();
  expect(afterTickB?.backfillBefore).not.toBe(originalSeedCursor);

  const events = await eventsFor(seeded.projectId);
  expect(events.length).toBe(eventTimes.length);
});

test("/: a connect-time first pull that hits its own tiny page cap is completed by the very next scheduled poll — the watermark actually moves", async () => {
  const eventTimes = [0, 1, 2].map((i) => new Date(NOW.getTime() - (i + 1) * 60_000));
  const env = testServerEnv();
  const seeded = await seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const posthog = createFakePostHog({
    events: positionalBacklog({ sourceProjectId: seeded.sourceProjectId, eventTimes }),
  });
  const clock = createFakeClock(NOW);

  const resolvedKey = resolveCredentialKey(env);
  if (!resolvedKey.ok) {
    throw new Error("test fixture: resolveCredentialKey refused");
  }

  const connectionsService = createConnectionsService(db, seeded.ownerCtx, {
    createSource: (config) =>
      createPostHogSessionSource(config, {
        fetch: posthog.fetch,
        sleep: clock.sleep,
        now: clock.now,
        random: () => 0.5,
        identityHmacKey: deriveIdentityHmacKey(resolvedKey.key),
      }),
    credentialKey: resolvedKey,
    now: clock.now,
  });

  const connectInput: ConnectInput = {
    projectId: seeded.projectId,
    sourceKind: "posthog",
    host: seeded.host,
    sourceProjectId: seeded.sourceProjectId,
    personalApiKey: "phx_fake-not-a-real-key-cr4-convergence",
  };

  const connected = await connectionsService.connect(connectInput);
  expect(connected.ok).toBe(true);
  if (!connected.ok) throw new Error("unreachable");

  expect(connected.connection.watermarkAt).toBeNull();
  expect(connected.connection.backfillBefore).not.toBeNull();
  expect(connected.firstPullEventsSeen).toBeGreaterThan(0);

  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const afterPoll = await connectionRow(seeded.connectionId);

  expect(afterPoll?.watermarkAt).not.toBeNull();
  expect(afterPoll?.watermarkAt?.getTime()).toBe(eventTimes[0]!.getTime());

  expect(afterPoll?.backfillBefore).toBeNull();

  const events = await eventsFor(seeded.projectId);
  expect(events.length).toBe(eventTimes.length);

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.some((run) => run.watermarkAdvancedTo !== null)).toBe(true);
});
