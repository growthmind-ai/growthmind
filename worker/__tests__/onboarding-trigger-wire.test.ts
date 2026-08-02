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

interface MirrorAnalysisTrigger {
  requestForProject(input: { readonly projectId: string }): Promise<void>;
}

type MirrorPollDepsWithTrigger = SessionSourcePollDeps & {
  readonly requestAnalysis: MirrorAnalysisTrigger;
};

type MirrorIsOnboardingPlan = (plan: PollPlan) => boolean;

const loadIsOnboardingPlan = (): Promise<MirrorIsOnboardingPlan> =>
  loadUnderConstruction<MirrorIsOnboardingPlan>({
    modulePath: underConstructionSpecifier("worker/src/tasks/poll-plan"),
    exportName: "isOnboardingPlan",
    ownedBy: OWNER_PLAN,
  });

interface RecordingTrigger extends MirrorAnalysisTrigger {
  readonly requested: string[];
}

function createRecordingTrigger(options: { throws?: boolean } = {}): RecordingTrigger {
  const requested: string[] = [];
  return {
    requested,
    requestForProject: (input) => {
      requested.push(input.projectId);
      if (options.throws === true) {
        return Promise.reject(new Error("o008w-trigger-unavailable"));
      }
      return Promise.resolve();
    },
  };
}

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

const INSIDE_WINDOW = new Date(NOW.getTime() - 5 * 60_000);

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

const emptyPage: FakeEventsPage = { results: [], next: null };

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

test("a poll pass that persists events inside the onboarding window requests analysis through the real entry point", async () => {
  const seeded = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: () => pageWithEvents("one") });

  await invokeTheHandler({ posthog, trigger });

  const events = await db.select().from(schema.events);
  expect(events.filter((row) => row.projectId === seeded.projectId).length).toBeGreaterThan(0);

  expect(trigger.requested).toEqual([seeded.projectId]);
});

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

test("a poll pass that persists zero events requests nothing", async () => {
  const seeded = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: () => emptyPage });

  await invokeTheHandler({ posthog, trigger });

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.every((row) => row.status === "completed")).toBe(true);

  expect(trigger.requested).toEqual([]);
});

test("a poll pass outside the onboarding window requests nothing", async () => {
  const seeded = await seedConnected({ connectedAt: OUTSIDE_WINDOW });
  const trigger = createRecordingTrigger();
  const posthog = createFakePostHog({ events: () => pageWithEvents("outside") });

  await invokeTheHandler({ posthog, trigger });

  const events = await db.select().from(schema.events);
  expect(events.filter((row) => row.projectId === seeded.projectId).length).toBeGreaterThan(0);

  expect(trigger.requested).toEqual([]);
});

test("a failing trigger leaves the poll run completed and the watermark advanced", async () => {
  const seeded = await seedConnected({ connectedAt: INSIDE_WINDOW });
  const trigger = createRecordingTrigger({ throws: true });
  const posthog = createFakePostHog({ events: () => pageWithEvents("d8") });

  await invokeTheHandler({ posthog, trigger });

  expect(trigger.requested).toEqual([seeded.projectId]);

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBeGreaterThan(0);
  expect(runs.every((row) => row.status === "completed")).toBe(true);

  const connection = await connectionRow(seeded.connectionId);
  expect(connection?.watermarkAt).not.toBeNull();
});

test("isOnboardingPlan is true for the four-pass plan and false for the one-pass plan", async () => {
  const isOnboardingPlan = await loadIsOnboardingPlan();

  const planAt = (elapsedMs: number): PollPlan =>
    resolvePollPlan({
      connectedAt: new Date(NOW.getTime() - elapsedMs),
      now: NOW,
      pollIntervalSeconds: 60,
    });

  const windowMs = ONBOARDING_WINDOW_MINUTES * 60_000;

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

  expect(isOnboardingPlan(atBoundary)).toBe(false);
  expect(isOnboardingPlan(past)).toBe(false);
});
