// O-008 Wave 0e, task 0e.2 — THE POLL SEAM. ADD §9, 5 rows (AD-11).
//
// ###########################################################################
// # THE D11 PROOF FOR THE TRIGGER. A PRODUCER TEST PLUS A CONSUMER TEST DO
// # NOT PROVE THE WIRE BETWEEN THEM.
// #
// # This sprint INHERITS `resolveDeliveryComposition()` returning `null`
// # precisely because the previous one left a value on the floor. D11's rule:
// # the value exists in the type system on both ends and nothing proves the
// # wire between them is connected. The consumer reads an always-absent
// # field, its "when present…" branch never runs, and every downstream gate
// # treats permanent absence as the legitimate no-signal case. Tests on the
// # producer pass. Tests on the consumer pass. THE INTEGRATION NOBODY WROTE
// # IS WHERE THE FEATURE DIES.
// #
// # So every row below drives `runSessionSourcePoll` — the REAL entry point,
// # the same plain function the queue closure in ../src/index.ts invokes,
// # with the deps that closure assembles — against a REAL `createTestDb()`
// # database and a FAKED PostHog HTTP layer. Nothing here calls
// # `pollConnection`, `runOnePass` or the trigger directly. A row that
// # reached past the entry point would be the producer-plus-consumer pair
// # this file exists to refuse.
// ###########################################################################
//
// THE CONDITION IS ASSERTED, NOT JUST THE CALL. Rows 2 and 3 are the halves
// that make row 1 mean something: a trigger that fires on EVERY pass would pass
// row 1 and fail both of them, and a wire proven only in the positive direction
// is a wire nobody has bounded.
//
// WHAT IS RED TODAY AND WHY. `SessionSourcePollDeps` has no `requestAnalysis`
// port and `poll-plan.ts` has no `isOnboardingPlan` — both are ADD Wave 3's.
// The module RESOLVES and the file READS, so this is the second shape of
// absence: `assertUnderConstruction` converts it into a named diagnostic rather
// than letting it surface as a bare `expect(0).toBe(1)` that reads like a flake.
//
// FIXTURE SEED PREFIX: `o008w-`.
import { afterEach, beforeEach, expect, test } from "bun:test";

import { schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";

import {
  assertUnderConstruction,
  loadUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  MAX_ONBOARDING_PASSES,
  ONBOARDING_WINDOW_MINUTES,
  resolvePollPlan,
  type PollPlan,
} from "../src/tasks/poll-plan";
import { runSessionSourcePoll } from "../src/tasks/session-source-poll";
import type { SessionSourcePollDeps } from "../src/tasks/session-source-poll";
import {
  createFakeClock,
  createFakePostHog,
  createPollDeps,
  encryptTestCredential,
  fakeEvent,
  seedPollableWorkspace,
  seedProjectWithConnection,
  testServerEnv,
  type FakeEventsPage,
  type FakePostHog,
  type SeededConnection,
  type SeededWorkspace,
} from "./helpers/wire-fixtures";

const PREFIX = "o008w-";
const NOW = new Date("2026-08-01T18:00:00.000Z");

const OWNER_POLL =
  "ADD Wave 3 (worker/src/tasks/session-source-poll.ts — the AnalysisTrigger port, AD-11)";
const OWNER_PLAN = "ADD Wave 3 (worker/src/tasks/poll-plan.ts — isOnboardingPlan, AD-11)";

const POLL_SOURCE_PATH = "worker/src/tasks/session-source-poll.ts";

// ===========================================================================
// THE CONTRACT MIRROR — AD-11(a), copied verbatim from the ADD's own TypeScript
// ===========================================================================

/** ADD AD-11, lines 363-367 — copied verbatim. */
interface MirrorAnalysisTrigger {
  /** Best-effort. Never throws — a failure to request is logged and the poll
   *  still succeeds (D8). The hourly cron is the floor if this never fires. */
  requestForProject(input: { readonly projectId: string }): Promise<void>;
}

/**
 * THE FIELD NAME IS `requestAnalysis`, from ADD §5's Wave 3 file table:
 * "`+ requestAnalysis: AnalysisTrigger` on deps". AD-11's own prose says only
 * "`SessionSourcePollDeps` gains" and never names the field — §5 is the more
 * specific source and wins. FLAGGED because it is a D9 stringly-typed wire: if
 * Wave 3 picks a different name, every row below fails loudly at
 * `assertUnderConstruction` rather than silently reading `undefined`.
 *
 * Declared as an INTERSECTION over the shipped interface rather than by
 * re-declaring `SessionSourcePollDeps`: every other member already exists
 * today, so mirroring them would invent drift, and an intersection stays
 * assignable to the real parameter type on both this tree and the next one.
 */
type MirrorPollDepsWithTrigger = SessionSourcePollDeps & {
  readonly requestAnalysis: MirrorAnalysisTrigger;
};

/** ADD AD-11, line 370 — "a new exported pure predicate `isOnboardingPlan(plan):
 *  boolean` on `poll-plan.ts` names the second condition rather than
 *  re-deriving the window arithmetic". */
type MirrorIsOnboardingPlan = (plan: PollPlan) => boolean;

const loadIsOnboardingPlan = (): Promise<MirrorIsOnboardingPlan> =>
  loadUnderConstruction<MirrorIsOnboardingPlan>({
    modulePath: underConstructionSpecifier("worker/src/tasks/poll-plan"),
    exportName: "isOnboardingPlan",
    ownedBy: OWNER_PLAN,
  });

// ===========================================================================
// The recording trigger — the whole point of the file
// ===========================================================================

interface RecordingTrigger extends MirrorAnalysisTrigger {
  /** Every project id the poll asked for, IN ORDER. Asserting on the sequence
   *  rather than on a count is what makes "exactly once, for this project"
   *  distinguishable from "once, for whichever project happened to be first". */
  readonly requested: string[];
}

function createRecordingTrigger(options: { throws?: boolean } = {}): RecordingTrigger {
  const requested: string[] = [];
  return {
    requested,
    requestForProject: (input) => {
      requested.push(input.projectId);
      if (options.throws === true) {
        // THE PORT IS CONTRACTED NEVER TO THROW. One that does anyway is
        // exactly what row 4's D8 isolation exists for — and the only honest
        // way to prove the call site guards it.
        return Promise.reject(new Error("o008w-trigger-unavailable"));
      }
      return Promise.resolve();
    },
  };
}

// ===========================================================================
// Fixtures
// ===========================================================================

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

/** Comfortably INSIDE the onboarding window — five minutes of a fifteen-minute
 *  window, so no boundary subtlety is load-bearing in a row that is not about
 *  the boundary. */
const INSIDE_WINDOW = new Date(NOW.getTime() - 5 * 60_000);

/** Comfortably OUTSIDE it — twenty minutes, so `resolvePollPlan` returns the
 *  one-pass plan. */
const OUTSIDE_WINDOW = new Date(NOW.getTime() - 20 * 60_000);

async function seedConnected(overrides: { connectedAt: Date }): Promise<SeededWorkspace> {
  const env = testServerEnv();
  return seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    connectedAt: overrides.connectedAt,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });
}

async function seedSecondProject(
  organizationId: string,
  overrides: { connectedAt: Date },
): Promise<SeededConnection> {
  const env = testServerEnv();
  return seedProjectWithConnection(db, {
    prefix: `${PREFIX}two-`,
    now: NOW,
    organizationId,
    connectedAt: overrides.connectedAt,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
  });
}

/** One ordinary visitor, so the pass PERSISTS EVENTS and `sawEvents` is true. */
function pageWithEvents(seed: string): FakeEventsPage {
  return {
    results: [
      fakeEvent({
        id: `${PREFIX}${seed}-evt-1`,
        distinctId: `${PREFIX}${seed}-visitor`,
        sessionId: `${PREFIX}${seed}-session`,
        name: "$pageview",
        occurredAt: new Date(NOW.getTime() - 60_000),
        pathname: "/pricing",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      }),
    ],
    next: null,
  };
}

/** A completed pull that persisted NOTHING — the upstream had no new events.
 *  Not a failure: a quiet product is an ordinary answer. */
const emptyPage: FakeEventsPage = { results: [], next: null };

/**
 * THE REAL ENTRY POINT, and the only way any row below reaches the poll.
 *
 * `assertUnderConstruction` runs BEFORE the call rather than after it, so a
 * tree without the port produces a red that names the port instead of a
 * `requested: []` diff that reads like a broken fixture.
 */
async function invokeTheHandler(params: {
  posthog: FakePostHog;
  trigger: RecordingTrigger;
}): Promise<void> {
  const clock = createFakeClock(NOW);
  const base = createPollDeps({ db, fetch: params.posthog.fetch, clock });

  assertUnderConstruction(pollDepsDeclareTrigger(), {
    contract:
      "SessionSourcePollDeps.requestAnalysis: AnalysisTrigger — the port pollConnection calls on a " +
      "qualifying pass (AD-11a)",
    ownedBy: OWNER_POLL,
  });

  const deps: MirrorPollDepsWithTrigger = { ...base, requestAnalysis: params.trigger };
  await runSessionSourcePoll(deps);
}

/**
 * Does the shipped handler declare the port at all?
 *
 * A STRUCTURAL CHECK RATHER THAN A BEHAVIOURAL ONE, deliberately: the deps are
 * a TypeScript interface with no runtime representation, so there is nothing to
 * probe on the value. Reading the source is the only way to tell "the wire is
 * not built yet" from "the wire is built and did not fire", and those two must
 * never produce the same red.
 */
function pollDepsDeclareTrigger(): boolean {
  const source = readSourceUnderConstruction({
    repoRelativePath: POLL_SOURCE_PATH,
    ownedBy: OWNER_POLL,
  });
  return source.includes("requestAnalysis") && source.includes("requestForProject");
}

async function pollRunsFor(connectionId: string) {
  const rows = await db.select().from(schema.sessionSourcePollRuns);
  return rows.filter((row) => row.connectionId === connectionId);
}

async function connectionRow(connectionId: string) {
  const rows = await db.select().from(schema.projectConnections);
  return rows.find((row) => row.id === connectionId);
}

// ###########################################################################
// Row 1 — THE WIRE. The real entry point, and exactly once.
// ###########################################################################
test("a poll pass that persists events inside the onboarding window requests analysis through the real entry point", async () => {
  const seeded = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: () => pageWithEvents("one") });

  await invokeTheHandler({ posthog, trigger });

  // The pass really did persist — otherwise this row would be asserting the
  // trigger fired for a pass that saw nothing, which is row 2's refusal.
  const events = await db.select().from(schema.events);
  expect(events.filter((row) => row.projectId === seeded.projectId).length).toBeGreaterThan(0);

  // EXACTLY ONCE, AND FOR THIS PROJECT. The sequence rather than the count, so
  // "once" cannot be satisfied by one call for the wrong project.
  expect(trigger.requested).toEqual([seeded.projectId]);
});

// Row 1, second leg — D3 multiplicity. `MAX_ONBOARDING_PASSES` is 4 and the
// pass loop breaks on the first pass that sees events, so a single connection
// makes "exactly once" nearly free. Two projects in ONE org is where a fan-out
// bug would actually show: once per project, never once per pass and never one
// call carrying whichever project the loop ended on.
test("two projects polled in one tick each request analysis exactly once, for themselves", async () => {
  const first = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const second = await seedSecondProject(first.organizationId, { connectedAt: INSIDE_WINDOW });

  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: (request) => pageWithEvents(request.url.pathname) });

  await invokeTheHandler({ posthog, trigger });

  expect(trigger.requested.toSorted()).toEqual([first.projectId, second.projectId].toSorted());
  expect(trigger.requested.filter((id) => id === first.projectId)).toHaveLength(1);
  expect(trigger.requested.filter((id) => id === second.projectId)).toHaveLength(1);
});

// ###########################################################################
// Row 2 — THE CONDITION, not just the call.
// ###########################################################################
test("a poll pass that persists zero events requests nothing", async () => {
  const seeded = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: () => emptyPage });

  await invokeTheHandler({ posthog, trigger });

  // The pass RAN — this is not a tick that found no connection due. It polled,
  // it completed, and it persisted nothing, which is the ordinary "your product
  // was quiet" answer and not a reason to spend a model call.
  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.every((row) => row.status === "completed")).toBe(true);

  expect(trigger.requested).toEqual([]);
});

// ###########################################################################
// Row 3 — `isOnboardingPlan` gates it.
// ###########################################################################
test("a poll pass outside the onboarding window requests nothing", async () => {
  const seeded = await seedConnected({ connectedAt: OUTSIDE_WINDOW });
  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: () => pageWithEvents("outside") });

  await invokeTheHandler({ posthog, trigger });

  // EVENTS WERE PERSISTED. So the ONLY thing standing between this pass and a
  // trigger is the window — which is the whole content of the row. A tick that
  // fired here would spend an analysis on ordinary steady-state traffic, every
  // minute, on every connection, forever.
  const events = await db.select().from(schema.events);
  expect(events.filter((row) => row.projectId === seeded.projectId).length).toBeGreaterThan(0);

  expect(trigger.requested).toEqual([]);
});

// ###########################################################################
// Row 4 — D8. The courtesy must not fail the thing it decorates.
// ###########################################################################
test("a failing trigger leaves the poll run completed and the watermark advanced", async () => {
  const seeded = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const trigger = createRecordingTrigger({ throws: true });
  const posthog = createFakePostHog({ events: () => pageWithEvents("d8") });

  // NO THROW OUT OF THE REAL ENTRY POINT.
  await invokeTheHandler({ posthog, trigger });

  // It really was called and it really did reject — otherwise this row would be
  // asserting D8 about a path nothing exercised.
  expect(trigger.requested).toEqual([seeded.projectId]);

  // THE MAIN FLOW STILL SUCCEEDED. The poll's job is to persist events; asking
  // for an analysis is a courtesy on top of that, and a courtesy that can fail
  // its host is a bug.
  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.every((row) => row.status === "completed")).toBe(true);

  // AND THE CURSOR MOVED. A watermark that did not advance would make the next
  // tick re-pull the same page forever — a failing courtesy converted into a
  // permanent loop.
  const connection = await connectionRow(seeded.connectionId);
  expect(connection?.watermarkAt).not.toBeNull();
});

// ###########################################################################
// Row 5 — the pure predicate. THE BOUNDARY IS READ OFF `resolvePollPlan`,
// NEVER RE-DERIVED.
// ###########################################################################
test("isOnboardingPlan is true for the four-pass plan and false for the one-pass plan", async () => {
  const isOnboardingPlan = await loadIsOnboardingPlan();

  const planAt = (elapsedMs: number): PollPlan =>
    resolvePollPlan({
      connectedAt: new Date(NOW.getTime() - elapsedMs),
      now: NOW,
      pollIntervalSeconds: 60,
    });

  const windowMs = ONBOARDING_WINDOW_MINUTES * 60_000;

  // AD-11 says this predicate exists to NAME the condition rather than
  // re-derive the window arithmetic, so every fixture below is built by
  // `resolvePollPlan` itself. A predicate tested against hand-built plans could
  // agree with a window the scheduler does not actually use.
  const fresh = planAt(0);
  const insideWindow = planAt(windowMs - 1);
  const atBoundary = planAt(windowMs);
  const past = planAt(windowMs + 60_000);

  expect(fresh.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(insideWindow.passes).toBe(MAX_ONBOARDING_PASSES);
  expect(atBoundary.passes).toBe(1);
  expect(past.passes).toBe(1);

  expect(isOnboardingPlan(fresh)).toBe(true);
  expect(isOnboardingPlan(insideWindow)).toBe(true);

  // EXCLUSIVE AT THE BOUNDARY, exactly as `resolvePollPlan` defines it
  // (`poll-plan.ts:117-120`: "exactly `ONBOARDING_WINDOW_MINUTES` elapsed is
  // outside"). Stated here rather than left to the arithmetic so it can never
  // drift silently between the scheduler and the predicate that reads it.
  expect(isOnboardingPlan(atBoundary)).toBe(false);
  expect(isOnboardingPlan(past)).toBe(false);
});
