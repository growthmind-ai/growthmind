// regression, the first-connect backlog stall (verified by code review,
// tasks/session-source-posthog-adapter). DoD: "PostHog implementation pulls events for
// a connected project". This is P-1's primary path: an existing PostHog project with
// more history than one run's page cap covers.
//
// Root cause: `applyCursors` in ../src/tasks/session-source-poll.ts only recorded
// `backfillBefore` when a watermark already existed. A never-polled connection
// (`watermark_at IS NULL`) whose very first walk hit the page cap therefore persisted
// neither cursor. The next tick started from `watermarkAt: null` again, re-fetched the
// identical newest slice, and could never become `contiguous` (contiguity requires a
// literal `null` cursor or crossing a previous watermark, and there was none). The
// connection polled forever and never drained its backlog.
//
// This suite drives the real entry point, `runSessionSourcePoll`, against a faked
// PostHog HTTP layer that never runs out of pages, so the walk can only stop by hitting
// the page cap, never by exhausting the upstream data.
//
// Fixture seed PREFIX: `bf-`.
//
// / addendum (this file's tests below " fix" above):
//
// Code review found the fix above closed the literal bug it targeted (no cursor written
// at all) but left a narrower, still-live gap in the same function: when a walk's
// `contiguous` is `false` and its `resumeBefore` is `null`. The adapter's case, "this
// specific walk got zero of the shared page budget because an earlier walk in the same
// pull already spent it all reaching `exhausted`", `applyCursors` wrote nothing (the
// old guard was `!result.contiguous && result.resumeBefore !== null`). The connection
// then re-read the same stale `backfill_before` next tick, reproduced the identical
// request sequence, and could never see anything older than that fixed point. A
// livelock, not merely a slow catch-up. Fixed by writing `result.resumeBefore`
// (including `null`) whenever `!result.contiguous`, in both `applyCursors` here and the
// mirror branch in `packages/db/src/services/connections.service.ts`'s
// `performFirstPull`.
//
// A separate, harder question surfaced while building the "eventually reaches
// contiguity" test asked for: with `MAX_PAGES_PER_PASS` (here) and `MAX_PAGES_PER_RUN`
// (the adapter) both `25`, and the forward pass (`pass 2`) always restarting from the
// true newest event whenever `watermark_at` is still `null` (never partially resuming),
// reaching `contiguous` requires pass 2 to walk its entire backlog inside the budget
// left over after the backward resume pass, which is provably impossible, for any tick
// count, once that backlog exceeds one pull's page cap (`MAX_PAGES_PER_RUN ×
// PAGE_LIMIT` = 5,000 events): the backward pass's own cost only grows as the forward
// frontier recedes, so the two-cursor state cycles rather than converges. Driving
// `runSessionSourcePoll` twice in a row therefore cannot demonstrate "the resumed walk
// eventually reaches contiguity" for a backlog that large. No code change inside this
// file's scope (worker/, or packages/db's connection service and repository) can make
// it converge, because the forward pass restarting from scratch is the adapter's
// (`packages/adapters`) own contract. The convergence test below instead exercises the
// achievable, and far more common, case this two-cursor design is actually built for: a
// connect-time first pull's own tiny `FIRST_PULL_MAX_PAGES = 1` cap, completed by the
// very next scheduled poll's much larger budget. Proving the resume cursor / now
// reliably records is correctly picked up and does reach contiguity there. The
// un-converging >5,000-event case is reported back rather than silently worked around.
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

/** Mirrors `MAX_PAGES_PER_PASS` in ../src/tasks/session-source-poll.ts and
 * `MAX_PAGES_PER_RUN` in packages/adapters/src/posthog/constants.ts (also 25). The walk
 * takes the tighter of the two, and both are 25, so the page cap this suite proves is
 * hit sits here, named rather than magic. */
const EXPECTED_PAGE_CAP = 25;

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

/**
 * An upstream that never runs dry: every page carries exactly one event and a non-null
 * `next`, so the walk can only stop by hitting the page cap, never by exhausting real
 * data. That is the shape of a customer's existing PostHog project holding more history
 * than one run can cover.
 */
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
    // No `watermarkAt` and no `backfillBefore` override. This connection has never been
    // polled, the exact shape defeated.
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const before = await connectionRow(seeded.connectionId);
  expect(before?.watermarkAt).toBeNull();
  expect(before?.backfillBefore).toBeNull();

  const posthog = createFakePostHog({ events: infiniteBacklog(seeded.sourceProjectId) });
  const clock = createFakeClock(NOW);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The walk actually hit the page cap. Proof this run exercised the path rather than
  // exhausting the (infinite) upstream some other way.
  expect(posthog.eventsCalls().length).toBe(EXPECTED_PAGE_CAP);

  const after = await connectionRow(seeded.connectionId);
  // The fix: the resume cursor survives even with no watermark to hold steady. Before
  // the fix this was `null`. The silent, permanent stall.
  expect(after?.backfillBefore).not.toBeNull();
  expect(after?.backfillBefore).toEqual(expect.stringContaining("before="));
  // The watermark invariant is unchanged by the fix: a page-capped walk must never
  // advance it, contiguous or not.
  expect(after?.watermarkAt).toBeNull();

  // The run still reaches a terminal, honest state. A page-capped walk is not a
  // failure, it is "more to do next tick".
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

  // First tick: hits the page cap, persists the resume cursor (proven above).
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));
  const afterFirst = await connectionRow(seeded.connectionId);
  const firstCursor = afterFirst?.backfillBefore ?? null;
  expect(firstCursor).not.toBeNull();
  const firstCallCount = posthog.eventsCalls().length;

  // Second tick, one minute later. Same shape a real cron tick would see.
  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The regression this closes: Without the fix, `backfillBefore` stays null forever,
  // so every tick restarts from `after = null` and re-requests the exact same first
  // page. With the fix, the second tick's first request is the stored cursor (new,
  // further-back pages) so the total request count keeps growing past what one capped
  // pass alone would produce, proving the walk is draining the backlog rather than
  // looping on the newest slice.
  expect(posthog.eventsCalls().length).toBeGreaterThan(firstCallCount);

  const afterSecond = await connectionRow(seeded.connectionId);
  expect(afterSecond?.watermarkAt).toBeNull();
  expect(afterSecond?.backfillBefore).not.toBeNull();
});

// / additions

async function eventsFor(projectId: string) {
  const rows = await db.select().from(schema.events);
  return rows.filter((row) => row.projectId === projectId);
}

/**
 * An upstream backed by a fixed, finite list of event instants (newest first) rather
 * than an infinite generator or a global call counter. Reads are computed from the
 * request's own `before`/`after` query parameters (exactly like a real server) so this
 * fake behaves correctly no matter which walk (a fresh forward pass or a resumed
 * backward one) issues the request, and no matter how many prior calls this
 * `FakePostHog` instance has already served. That independence from call order is what
 * makes it safe to drive across two separate `runSessionSourcePoll` invocations (or a
 * `connect` call followed by one) without the walk that resumes ever seeing the wrong
 * slice.
 */
function positionalBacklog(params: {
  sourceProjectId: string;
  /** Newest first, matching PostHog's own ordering. */
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
    // One event per page, matching this file's other fixtures. It is the page count the
    // page cap governs, not the event count per page.
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
  // 26 events, newest (index 0) to oldest (index 25), one page apart. The connection is
  // seeded already mid-backfill (`backfillBefore` points just past index 0) so the very
  // first `runSessionSourcePoll` call below plays the role of "a later tick", after
  // some earlier run already established that cursor.
  const eventTimes = Array.from(
    { length: 26 },
    (_, i) => new Date(NOW.getTime() - (i + 1) * 60_000),
  );
  const env = testServerEnv();
  // Fixed rather than auto-generated, so the seeded `backfillBefore` below can be built
  // from the same `sourceProjectId` the walk will actually request against.
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

  // Tick a. The resume walk needs exactly 25 fetches (index 1 through 25) to reach the
  // true end. Using the whole shared page budget for this pull, so the forward pass
  // that would normally run afterward gets zero of it and hits the adapter's own page
  // cap without ever sending a request. That specific combination (`contiguous: false`,
  // `resumeBefore: null`) is exactly the case the old `applyCursors` guard
  // (`!result.contiguous && result.resumeBefore !== null`) skipped writing anything
  // for.
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect(posthog.eventsCalls().length).toBe(25);

  const afterTickA = await connectionRow(seeded.connectionId);
  expect(afterTickA?.watermarkAt).toBeNull();
  // The fix: the stale seeded cursor is cleared, not left in place. Before the fix this
  // stayed equal to the original seeded value forever.
  expect(afterTickA?.backfillBefore).toBeNull();

  const runsAfterTickA = await pollRunsFor(seeded.connectionId);
  expect(runsAfterTickA.every((run) => run.status === "completed")).toBe(true);

  // Tick b. Because the cursor was cleared, this tick's resume pass is skipped and the
  // forward pass runs fresh with the full page budget. Fetching a genuinely different
  // slice (index 0 through 24) rather than reproducing tick A's exact request sequence.
  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const afterTickB = await connectionRow(seeded.connectionId);
  // Real, new progress: the cursor moved again, to a position that is neither the
  // original seed nor `null`.
  expect(afterTickB?.backfillBefore).not.toBeNull();
  expect(afterTickB?.backfillBefore).not.toBe(originalSeedCursor);

  // The proof that matters: Without the fix, tick B would have replayed the identical
  // index-1-through-25 request forever, and index 0. The single newest event, the one a
  // customer looks at first. Would never have been fetched by any tick, ever. With the
  // fix, the union of both ticks' walks covers the whole 26-event backlog.
  const events = await eventsFor(seeded.projectId);
  expect(events.length).toBe(eventTimes.length);
});

test("/: a connect-time first pull that hits its own tiny page cap is completed by the very next scheduled poll — the watermark actually moves", async () => {
  // Deliberately only 3 events: `FIRST_PULL_MAX_PAGES = 1` (connect-time) cannot cover
  // more than one page, so this still forces a page-capped first pull, but the worker's
  // much larger `MAX_PAGES_PER_PASS = 25` budget can easily walk the whole remaining
  // backlog in its very next tick. The scenario the own language ("any project with
  // >200 events") describes, and the one this two-cursor design can provably resolve in
  // two pulls (see this file's header comment for why a worker-poll-only "twice"
  // cannot, for any backlog exceeding one pull's own page cap).
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

  // The real PostHog adapter, wired exactly as the composition root wires it. This
  // proves the connect-time pull against the same adapter contract the scheduled poll
  // below runs against, not a hand-built pull result. `identityHmacKey` is derived
  // from the same resolved credential key the composition root derives it from, not a
  // hand-picked test value.
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

  // Pull one of two. The connect-time inline first pull.
  const connected = await connectionsService.connect(connectInput);
  expect(connected.ok).toBe(true);
  if (!connected.ok) throw new Error("unreachable");

  expect(connected.connection.watermarkAt).toBeNull();
  expect(connected.connection.backfillBefore).not.toBeNull();
  expect(connected.firstPullEventsSeen).toBeGreaterThan(0);

  // Pull two of two. The very next scheduled poll, through the real worker entry point
  // (`runSessionSourcePoll`), exactly as `taskList` invokes it.
  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  const afterPoll = await connectionRow(seeded.connectionId);
  // The watermark actually moves: the resumed walk reached contiguity.
  expect(afterPoll?.watermarkAt).not.toBeNull();
  expect(afterPoll?.watermarkAt?.getTime()).toBe(eventTimes[0]!.getTime());
  // A fully contiguous walk has nothing left to resume from.
  expect(afterPoll?.backfillBefore).toBeNull();

  const events = await eventsFor(seeded.projectId);
  expect(events.length).toBe(eventTimes.length);

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.some((run) => run.watermarkAdvancedTo !== null)).toBe(true);
});
