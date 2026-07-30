// CR-1 regression — the first-connect backlog stall (verified by code
// review, tasks/session-source-posthog-adapter). O-003 DoD: "PostHog
// implementation pulls events for a connected project" — this is P-1's
// primary path: an existing PostHog project with more history than one run's
// page cap covers.
//
// Root cause: `applyCursors` in ../src/tasks/session-source-poll.ts only
// recorded `backfillBefore` when a watermark already existed. A
// NEVER-POLLED connection (`watermark_at IS NULL`) whose very first walk hit
// the page cap therefore persisted NEITHER cursor — the next tick started
// from `watermarkAt: null` again, re-fetched the identical newest slice, and
// could never become `contiguous` (contiguity requires a literal `null`
// cursor or crossing a PREVIOUS watermark, and there was none). The
// connection polled forever and never drained its backlog.
//
// This suite drives the REAL entry point, `runSessionSourcePoll`, against a
// FAKED PostHog HTTP layer that never runs out of pages — so the walk can
// only stop by hitting the page cap, never by exhausting the upstream data.
//
// FIXTURE SEED PREFIX: `bf-`.
import { afterEach, beforeEach, expect, test } from "bun:test";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";

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

/** Mirrors `MAX_PAGES_PER_PASS` in ../src/tasks/session-source-poll.ts (25)
 * and `MAX_PAGES_PER_RUN` in packages/adapters/src/posthog/constants.ts
 * (also 25) — the walk takes the TIGHTER of the two, and both are 25, so the
 * page cap this suite proves is hit sits here, named rather than magic. */
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
 * An upstream that NEVER runs dry: every page carries exactly one event and a
 * non-null `next`, so the walk can only stop by hitting the page cap — never
 * by exhausting real data. That is the shape of a customer's existing
 * PostHog project holding more history than one run can cover.
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

test("CR-1: a never-polled connection whose first walk hits the page cap persists a resume cursor and does NOT advance the watermark", async () => {
  const env = testServerEnv();
  const seeded = await seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    // No `watermarkAt` and no `backfillBefore` override — this connection
    // has NEVER been polled, the exact shape CR-1 defeated.
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });

  const before = await connectionRow(seeded.connectionId);
  expect(before?.watermarkAt).toBeNull();
  expect(before?.backfillBefore).toBeNull();

  const posthog = createFakePostHog({ events: infiniteBacklog(seeded.sourceProjectId) });
  const clock = createFakeClock(NOW);

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The walk actually hit the page cap — proof this run exercised the CR-1
  // path rather than exhausting the (infinite) upstream some other way.
  expect(posthog.eventsCalls().length).toBe(EXPECTED_PAGE_CAP);

  const after = await connectionRow(seeded.connectionId);
  // THE FIX: the resume cursor survives even with no watermark to hold
  // steady. Before the fix this was `null` — the silent, permanent stall.
  expect(after?.backfillBefore).not.toBeNull();
  expect(after?.backfillBefore).toEqual(expect.stringContaining("before="));
  // The watermark invariant is unchanged by the fix: a page-capped walk must
  // never advance it, contiguous or not.
  expect(after?.watermarkAt).toBeNull();

  // The run still reaches a terminal, honest state — a page-capped walk is
  // NOT a failure, it is "more to do next tick".
  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThanOrEqual(1);
  expect(runs.every((run) => run.status === "completed")).toBe(true);
  expect(runs.every((run) => run.watermarkAdvancedTo === null)).toBe(true);
});

test("CR-1: the persisted resume cursor is actually consumed on the next tick — the backlog drains instead of re-fetching the same slice forever", async () => {
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

  // Second tick, one minute later — same shape a real cron tick would see.
  clock.advance(60_000);
  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  // The regression this closes: WITHOUT the fix, `backfillBefore` stays null
  // forever, so every tick restarts from `after = null` and re-requests the
  // exact same first page. WITH the fix, the second tick's first request is
  // the stored cursor — new, further-back pages — so the total request count
  // keeps growing past what one capped pass alone would produce, proving the
  // walk is draining the backlog rather than looping on the newest slice.
  expect(posthog.eventsCalls().length).toBeGreaterThan(firstCallCount);

  const afterSecond = await connectionRow(seeded.connectionId);
  expect(afterSecond?.watermarkAt).toBeNull();
  expect(afterSecond?.backfillBefore).not.toBeNull();
});
