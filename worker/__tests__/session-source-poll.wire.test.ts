import { afterEach, beforeEach, expect, test } from "bun:test";

import { createEventsCounterService, schema } from "@growthmind/db";
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
  seedTeammateContext,
  testServerEnv,
  type FakeEventsPage,
  type FakePostHog,
  type SeededWorkspace,
} from "./helpers/wire-fixtures";

const PREFIX = "e2e-";
const NOW = new Date("2026-07-30T18:00:00.000Z");
const INTERNAL_DOMAIN = "e2e-acme.example";

let db: TestDb;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

async function seedConnectedWorkspace(
  overrides: { watermarkAt?: Date | null } = {},
): Promise<SeededWorkspace> {
  const env = testServerEnv();
  return seedPollableWorkspace(db, {
    prefix: PREFIX,
    now: NOW,
    inferredInternalDomain: INTERNAL_DOMAIN,
    credentialFor: (ids) => encryptTestCredential({ env, ...ids }),
    ...(overrides.watermarkAt === undefined ? {} : { watermarkAt: overrides.watermarkAt }),
  });
}

async function invokeTheHandler(params: { posthog: FakePostHog; now?: Date }): Promise<void> {
  const clock = createFakeClock(params.now ?? NOW);
  await runSessionSourcePoll(createPollDeps({ db, fetch: params.posthog.fetch, clock }));
}

async function sessionsFor(projectId: string) {
  const rows = await db.select().from(schema.sessions);
  return rows.filter((row) => row.projectId === projectId);
}

async function eventsFor(projectId: string) {
  const rows = await db.select().from(schema.events);
  return rows.filter((row) => row.projectId === projectId);
}

function setAsideCount(
  breakdown: readonly { reason: string; count: number }[],
  reason: string,
): number {
  return breakdown.find((row) => row.reason === reason)?.count ?? 0;
}

function twoSessionPage(): FakeEventsPage {
  return {
    results: [
      fakeEvent({
        id: `${PREFIX}evt-kept-2`,
        distinctId: `${PREFIX}visitor-kept`,
        sessionId: `${PREFIX}session-kept`,
        name: "$pageview",
        occurredAt: new Date(NOW.getTime() - 60_000),
        pathname: "/pricing",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      }),
      fakeEvent({
        id: `${PREFIX}evt-headless-1`,
        distinctId: `${PREFIX}visitor-headless`,
        sessionId: `${PREFIX}session-headless`,
        name: "$pageview",
        occurredAt: new Date(NOW.getTime() - 90_000),
        pathname: "/",
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
      }),
      fakeEvent({
        id: `${PREFIX}evt-kept-1`,
        distinctId: `${PREFIX}visitor-kept`,
        sessionId: `${PREFIX}session-kept`,
        name: "$identify",
        occurredAt: new Date(NOW.getTime() - 120_000),
        pathname: "/",
        setEmail: `buyer@${PREFIX}customer.example`,
      }),
    ],
    next: null,
  };
}

test("credentials → pull → exclusion → persistence → counter: the handler persists sessions and events with the expected exclusion_reason stamps AND the counter returns the matching kept/set-aside breakdown", async () => {
  const seeded = await seedConnectedWorkspace();
  const posthog = createFakePostHog({ events: () => twoSessionPage() });

  await invokeTheHandler({ posthog });

  expect(posthog.eventsCalls().length).toBeGreaterThan(0);
  expect(posthog.eventsCalls()[0]?.authorization).toContain("Bearer ");

  const sessions = await sessionsFor(seeded.projectId);
  expect(sessions.length).toBe(2);

  const kept = sessions.find((row) => row.sessionKey.includes(`${PREFIX}session-kept`));
  const headless = sessions.find((row) => row.sessionKey.includes(`${PREFIX}session-headless`));

  expect(kept?.exclusionReason).toBe("none");
  expect(headless?.exclusionReason).toBe("automation_headless");

  expect(kept?.identityEmailDomain).toBe(`${PREFIX}customer.example`);
  expect(kept?.identityEmailDomain).not.toContain("@");
  expect(kept?.identityResolution).toBe("resolved");
  expect(kept?.organizationId).toBe(seeded.organizationId);

  const events = await eventsFor(seeded.projectId);
  expect(events.length).toBe(3);
  expect(events.every((row) => row.organizationId === seeded.organizationId)).toBe(true);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);

  expect(counter.totalReceived).toBe(3);
  expect(counter.kept).toBe(2);
  expect(setAsideCount(counter.setAside, "automation_headless")).toBe(1);
  expect(counter.droppedUnreadable).toBe(0);
  expect(counter.state.status).toBe("connected_receiving");

  expect(
    counter.kept +
      counter.setAside.reduce((sum, row) => sum + row.count, 0) +
      counter.droppedUnreadable,
  ).toBe(counter.totalReceived);
});

test("running the handler twice against the same upstream page yields one row per event and one session", async () => {
  const seeded = await seedConnectedWorkspace();
  const posthog = createFakePostHog({ events: () => twoSessionPage() });

  await invokeTheHandler({ posthog });

  await invokeTheHandler({ posthog, now: new Date(NOW.getTime() + 5 * 60_000) });

  expect(posthog.eventsCalls().length).toBeGreaterThanOrEqual(2);

  expect((await eventsFor(seeded.projectId)).length).toBe(3);
  expect((await sessionsFor(seeded.projectId)).length).toBe(2);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  expect(counter.totalReceived).toBe(3);
});

test("an event whose declared timestamp predates the watermark is persisted exactly once by the overlap re-query", async () => {
  const watermark = new Date(NOW.getTime() - 5 * 60_000);
  const seeded = await seedConnectedWorkspace({ watermarkAt: watermark });

  const backdated = new Date(watermark.getTime() - 2 * 60_000);
  const posthog = createFakePostHog({
    events: (): FakeEventsPage => ({
      results: [
        fakeEvent({
          id: `${PREFIX}evt-backdated`,
          distinctId: `${PREFIX}visitor-late`,
          sessionId: `${PREFIX}session-late`,
          occurredAt: backdated,
          pathname: "/checkout",
        }),
      ],
      next: null,
    }),
  });

  await invokeTheHandler({ posthog });

  const firstAfter = new URL(posthog.eventsCalls()[0]?.url ?? "https://x.invalid").searchParams.get(
    "after",
  );
  expect(firstAfter).not.toBeNull();
  expect(Date.parse(firstAfter ?? "")).toBeLessThan(watermark.getTime());

  await invokeTheHandler({ posthog, now: new Date(NOW.getTime() + 5 * 60_000) });

  const rows = (await db.select().from(schema.events)).filter(
    (row) => row.sourceEventId === `${PREFIX}evt-backdated`,
  );
  expect(rows.length).toBe(1);
  expect(rows[0]?.occurredAt?.getTime()).toBe(backdated.getTime());
  expect(rows[0]?.projectId).toBe(seeded.projectId);

  expect((await sessionsFor(seeded.projectId)).length).toBe(1);
});

test("a headless-UA session and an internal-domain session are set aside, and an ordinary session with an external email is kept — end to end", async () => {
  const seeded = await seedConnectedWorkspace();
  const posthog = createFakePostHog({
    events: (): FakeEventsPage => ({
      results: [
        fakeEvent({
          id: `${PREFIX}evt-external`,
          distinctId: `${PREFIX}visitor-external`,
          sessionId: `${PREFIX}session-external`,
          occurredAt: new Date(NOW.getTime() - 60_000),
          pathname: "/pricing",
          setEmail: `buyer@${PREFIX}customer.example`,
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        }),
        fakeEvent({
          id: `${PREFIX}evt-internal`,
          distinctId: `${PREFIX}visitor-internal`,
          sessionId: `${PREFIX}session-internal`,
          occurredAt: new Date(NOW.getTime() - 90_000),
          pathname: "/admin",
          setEmail: `staff@${INTERNAL_DOMAIN}`,
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        }),
        fakeEvent({
          id: `${PREFIX}evt-headless`,
          distinctId: `${PREFIX}visitor-headless`,
          sessionId: `${PREFIX}session-headless`,
          occurredAt: new Date(NOW.getTime() - 120_000),
          pathname: "/",
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
        }),
      ],
      next: null,
    }),
  });

  await invokeTheHandler({ posthog });

  const sessions = await sessionsFor(seeded.projectId);
  const byKey = (fragment: string) => sessions.find((row) => row.sessionKey.includes(fragment));

  expect(byKey(`${PREFIX}session-external`)?.exclusionReason).toBe("none");
  expect(byKey(`${PREFIX}session-internal`)?.exclusionReason).toBe("internal_domain");
  expect(byKey(`${PREFIX}session-headless`)?.exclusionReason).toBe("automation_headless");

  expect(byKey(`${PREFIX}session-internal`)?.internalDomainAtStamp).toBe(INTERNAL_DOMAIN);
  expect(sessions.every((row) => typeof row.exclusionRuleSetVersion === "number")).toBe(true);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  expect(counter.totalReceived).toBe(3);
  expect(counter.kept).toBe(1);
  expect(setAsideCount(counter.setAside, "internal_domain")).toBe(1);
  expect(setAsideCount(counter.setAside, "automation_headless")).toBe(1);
});

test("a page containing one malformed event persists the remaining events and reports droppedUnreadable in the counter", async () => {
  const seeded = await seedConnectedWorkspace();
  const posthog = createFakePostHog({
    events: (): FakeEventsPage => ({
      results: [
        fakeEvent({
          id: `${PREFIX}evt-good-1`,
          distinctId: `${PREFIX}visitor`,
          sessionId: `${PREFIX}session-good`,
          occurredAt: new Date(NOW.getTime() - 60_000),
          pathname: "/pricing",
        }),

        { id: null, timestamp: "not-a-date", properties: "not an object" },
        fakeEvent({
          id: `${PREFIX}evt-good-2`,
          distinctId: `${PREFIX}visitor`,
          sessionId: `${PREFIX}session-good`,
          occurredAt: new Date(NOW.getTime() - 90_000),
          pathname: "/",
        }),
      ],
      next: null,
    }),
  });

  await invokeTheHandler({ posthog });

  expect((await eventsFor(seeded.projectId)).length).toBe(2);

  const runs = (await db.select().from(schema.sessionSourcePollRuns)).filter(
    (row) => row.connectionId === seeded.connectionId,
  );
  expect(runs.some((run) => run.eventsDroppedMalformed === 1)).toBe(true);

  expect(runs.every((run) => run.status !== "running")).toBe(true);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  expect(counter.droppedUnreadable).toBe(1);

  expect(
    counter.kept +
      counter.setAside.reduce((sum, row) => sum + row.count, 0) +
      counter.droppedUnreadable,
  ).toBe(counter.totalReceived);
});

test("a teammate's tenant context reads the same counter values the connecting owner sees", async () => {
  const seeded = await seedConnectedWorkspace();
  const teammateCtx = await seedTeammateContext(db, {
    prefix: PREFIX,
    organizationId: seeded.organizationId,
    organizationName: seeded.organizationName,
  });
  const posthog = createFakePostHog({ events: () => twoSessionPage() });

  await invokeTheHandler({ posthog });

  const ownerView = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  const teammateView = await createEventsCounterService(db, teammateCtx).read(seeded.projectId);

  expect(teammateView.totalReceived).toBe(ownerView.totalReceived);
  expect(teammateView.kept).toBe(ownerView.kept);
  expect(teammateView.droppedUnreadable).toBe(ownerView.droppedUnreadable);
  expect(teammateView.setAside).toEqual(ownerView.setAside);
  expect(teammateView.state.status).toBe(ownerView.state.status);
  expect(teammateView.asOf?.getTime()).toBe(ownerView.asOf?.getTime());
  expect(teammateView.totalReceived).toBeGreaterThan(0);
});

test("the fake cursor is an absolute url carrying an exclusive before parameter", () => {
  const cursor = new URL(
    nextCursorUrl({ sourceProjectId: "e2e-src", before: new Date("2026-07-30T17:57:49.891Z") }),
  );

  expect(cursor.protocol).toBe("https:");
  expect(cursor.searchParams.get("before")).toBe("2026-07-30T17:57:49.891000+00:00");
});
