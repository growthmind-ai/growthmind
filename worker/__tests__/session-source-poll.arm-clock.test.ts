import { readFileSync } from "node:fs";

import { afterEach, beforeEach, expect, test } from "bun:test";

import { createFirstRunRepo, schema } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { MAX_ONBOARDING_PASSES } from "../src/tasks/poll-plan";
import { runSessionSourcePoll } from "../src/tasks/session-source-poll";
import {
  createFakeClock,
  createFakePostHog,
  createPollDeps,
  createRecordingLogger,
  encryptTestCredential,
  fakeEvent,
  seedPollableWorkspace,
  seedProjectWithConnection,
  testServerEnv,
  type SeededConnection,
  type SeededWorkspace,
} from "./helpers/wire-fixtures";

const PREFIX = "arm-";

const NOW = new Date("2026-07-30T18:00:00.000Z");

const STALE_CONNECTED_AT = new Date(NOW.getTime() - 30 * 60_000);

const FRESH_CONNECTED_AT = new Date(NOW.getTime() - 60_000);

const NOT_DUE_YET = new Date(NOW.getTime() + 60 * 60_000);

const POLL_TASK_SOURCE = new URL("../src/tasks/session-source-poll.ts", import.meta.url);

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
    connectedAt: STALE_CONNECTED_AT,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
    ...overrides,
  });
}

async function seedSibling(
  organizationId: string,
  overrides: Partial<Parameters<typeof seedProjectWithConnection>[1]> = {},
): Promise<SeededConnection> {
  const env = testServerEnv();
  return seedProjectWithConnection(db, {
    prefix: PREFIX,
    now: NOW,
    organizationId,
    connectedAt: STALE_CONNECTED_AT,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
    ...overrides,
  });
}

async function armProject(
  workspace: SeededWorkspace,
  projectId: string,
  armedAt: Date,
): Promise<void> {
  await createFirstRunRepo(db, workspace.ownerCtx).arm(projectId, armedAt);
}

async function pollRunsFor(connectionId: string) {
  const rows = await db.select().from(schema.sessionSourcePollRuns);
  return rows.filter((row) => row.connectionId === connectionId);
}

const quietPostHog = () => createFakePostHog({ events: () => ({ results: [], next: null }) });

const busyPostHog = () =>
  createFakePostHog({
    events: () => ({
      results: [
        fakeEvent({
          distinctId: `${PREFIX}visitor`,
          sessionId: `${PREFIX}session`,
          occurredAt: new Date(NOW.getTime() - 60_000),
          pathname: "/pricing",
        }),
      ],
      next: null,
    }),
  });

interface RecordedTrigger {
  readonly calls: { readonly projectId: string }[];
  readonly requestForProject: (input: { readonly projectId: string }) => Promise<void>;
}

function recordingTrigger(): RecordedTrigger {
  const calls: { readonly projectId: string }[] = [];
  return {
    calls,
    requestForProject: (input) => {
      calls.push(input);
      return Promise.resolve();
    },
  };
}

const FAILED_READ_SQL =
  'select "armed_at", "slack_skipped_at" from "first_run_state" where "organization_id" = $1 and "project_id" = $2';

function dbThatFailsToRead(realDb: TestDb, table: unknown, bound: readonly string[]): TestDb {
  const refuse = (): never => {
    throw Object.assign(new Error("this project's setup row could not be read"), {
      query: FAILED_READ_SQL,
      parameters: [...bound],
    });
  };

  const wrapBuilder = (builder: object): object =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "from") {
          return (arg: unknown) => {
            if (arg === table) refuse();
            const from = Reflect.get(target, prop, target) as (a: unknown) => unknown;
            return from.call(target, arg);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });

  return new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === "select") {
        return (...args: unknown[]) => {
          const select = Reflect.get(target, prop, receiver) as (...a: unknown[]) => object;
          return wrapBuilder(select.apply(target, args));
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as TestDb;
}

test("the poll task reads the arm clock for the connection's own project", async () => {
  const seeded = await seedWired();
  await armProject(seeded, seeded.projectId, NOW);

  const clock = createFakeClock(NOW);
  const posthog = quietPostHog();

  const summary = await runSessionSourcePoll(
    createPollDeps({ db, fetch: posthog.fetch, clock, logger: createRecordingLogger() }),
  );

  expect(summary.connectionsPolled).toBe(1);
  expect(summary.connectionsFailed).toBe(0);

  expect((await pollRunsFor(seeded.connectionId)).length).toBe(MAX_ONBOARDING_PASSES);
});

test("the arm clock read filters by organization and project together", async () => {
  const orgA = await seedWired();
  const orgB = await seedWired({ nextPollAt: NOT_DUE_YET });

  await armProject(orgB, orgB.projectId, NOW);

  const otherProjectInA = await seedSibling(orgA.organizationId, { nextPollAt: NOT_DUE_YET });
  await armProject(orgA, otherProjectInA.projectId, NOW);

  const clock = createFakeClock(NOW);
  const posthog = quietPostHog();

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock }));

  expect((await pollRunsFor(orgA.connectionId)).length).toBe(1);

  expect((await pollRunsFor(orgB.connectionId)).length).toBe(0);
  expect((await pollRunsFor(otherProjectInA.connectionId)).length).toBe(0);
});

test("a project with no first run row polls exactly as it does today", async () => {
  const stale = await seedWired();
  const logger = createRecordingLogger();

  const clock = createFakeClock(NOW);
  const posthog = quietPostHog();

  await runSessionSourcePoll(createPollDeps({ db, fetch: posthog.fetch, clock, logger }));

  const runs = await pollRunsFor(stale.connectionId);
  expect(runs.length).toBe(1);
  expect(runs[0]?.status).toBe("completed");
  expect(runs[0]?.outcome).toBe("no_new_events");

  expect(logger.errors).toEqual([]);

  expect(await db.select().from(schema.firstRunState)).toEqual([]);
});

test("a stale connection armed now reaches the fast path end to end", async () => {
  const seeded = await seedWired();
  await armProject(seeded, seeded.projectId, NOW);

  const trigger = recordingTrigger();
  const clock = createFakeClock(NOW);
  const posthog = busyPostHog();

  await runSessionSourcePoll(
    createPollDeps({ db, fetch: posthog.fetch, clock, requestAnalysis: trigger }),
  );

  expect(trigger.calls).toEqual([{ projectId: seeded.projectId }]);
});

test("a throwing arm clock read leaves the poll successful on the connect-clock plan", async () => {
  const seeded = await seedWired();
  await armProject(seeded, seeded.projectId, NOW);

  const logger = createRecordingLogger();
  const clock = createFakeClock(NOW);
  const posthog = quietPostHog();

  const bound = [seeded.organizationId, seeded.projectId];
  const blindDb = dbThatFailsToRead(db, schema.firstRunState, bound);

  const summary = await runSessionSourcePoll(
    createPollDeps({ db: blindDb, fetch: posthog.fetch, clock, logger }),
  );

  expect(summary.connectionsPolled).toBe(1);
  expect(summary.connectionsFailed).toBe(0);

  const runs = await pollRunsFor(seeded.connectionId);
  expect(runs.length).toBe(1);
  expect(runs[0]?.status).toBe("completed");

  const logged = logger.errors.join("\n");
  expect(logged).toContain(seeded.connectionId);
  expect(logged).not.toContain(FAILED_READ_SQL);
  expect(logged).not.toContain("select ");
  for (const value of bound) {
    expect(logged).not.toContain(value);
  }
});

test("the fast path opened by the arm clock uses the same trigger as the connect clock", async () => {
  const armed = await seedWired();
  await armProject(armed, armed.projectId, NOW);

  const byArmClock = recordingTrigger();
  const posthog = busyPostHog();

  await runSessionSourcePoll(
    createPollDeps({
      db,
      fetch: posthog.fetch,
      clock: createFakeClock(NOW),
      requestAnalysis: byArmClock,
    }),
  );

  await close();
  ({ db, close } = await createTestDb());

  const fresh = await seedWired({ connectedAt: FRESH_CONNECTED_AT });

  const byConnectClock = recordingTrigger();

  await runSessionSourcePoll(
    createPollDeps({
      db,
      fetch: busyPostHog().fetch,
      clock: createFakeClock(NOW),
      requestAnalysis: byConnectClock,
    }),
  );

  expect(byArmClock.calls).toEqual([{ projectId: armed.projectId }]);
  expect(byConnectClock.calls).toEqual([{ projectId: fresh.projectId }]);

  const source = readFileSync(POLL_TASK_SOURCE, "utf8");

  expect(source.match(/\.requestForProject\(/g)?.length).toBe(1);
  expect(source).not.toContain("addJob");
  expect(source).not.toContain("jobKey");
  expect(source).not.toContain("TASK.");
});
