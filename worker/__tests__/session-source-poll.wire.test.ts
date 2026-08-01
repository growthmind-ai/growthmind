// items 115–120, the end-to-end wire proof.
//
// The single most important test file in the sprint. The previous sprint shipped
// exactly this bug: a value computed by one surface with zero production consumers,
// where a producer test passed, a consumer test passed, and the wire between them was
// never connected.
//
// So every test below drives the real consumer entry point. The worker task handler
// `runSessionSourcePoll`, invoked exactly as `taskList` invokes it: a plain call with
// the deps the queue closure assembles, and no payload. Against a faked PostHog HTTP
// layer and a real `createTestDb` database. Then it asserts the effect actually
// fired, at both ends of the five-link chain:
//
// credentials → SessionSource pull → exclusion evaluation → persistence
//  → counter
//
// Nothing here reaches past the handler. There is no direct call to the adapter, no
// direct call to `persistPullResult`, and no hand-built pull result. The credential is
// encrypted with the real `encryptSecret` against the real key the handler's own
// environment resolves, so link one is proven too rather than stubbed around. The
// counter is read through the real `createEventsCounterService`, so link five is a live
// read of persisted rows rather than a returned summary the handler happened to
// compute.
//
// Fixture seed PREFIX: `e2e-`. Every org name, user email, and project name carries it
// plus a uuid, so this suite can never collide with another lane's fixtures on
// `user_email_unique`.
//
// Wave 0: the chain is typed stubs end to end. Every test here must fail on a stub's
// "not implemented", never on a compile error or a fixture collision.
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

/**
 * A connection whose stored credential the handler can actually read back. The
 * ciphertext goes through the real `encryptSecret` against the real key
 * `resolveCredentialKey` derives from the same `ServerEnv` the handler is given. A
 * hand-written placeholder would only ever exercise the F-11 fail-closed branch and
 * would prove nothing about link one of the chain.
 */
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

/** The real entry point. Every test goes through this one call, the same plain function
 * the queue closure in./src/index.ts invokes, with the same deps and no payload. */
async function invokeTheHandler(params: { posthog: FakePostHog; now?: Date }): Promise<void> {
  const clock = createFakeClock(params.now ?? NOW);
  await runSessionSourcePoll(createPollDeps({ db, fetch: params.posthog.fetch, clock }));
}

// Filtering happens in TypeScript rather than in SQL so this suite needs no
// `drizzle-orm` import of its own. The worker package depends on `@growthmind/db`, not
// on the ORM directly.
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

// The upstream page every test builds on: one ordinary visitor with an external email
// (kept) and one headless session (set aside).
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

// Item 115, the whole chain, end to end

test("credentials → pull → exclusion → persistence → counter: the handler persists sessions and events with the expected exclusion_reason stamps AND the counter returns the matching kept/set-aside breakdown", async () => {
  const seeded = await seedConnectedWorkspace();
  const posthog = createFakePostHog({ events: () => twoSessionPage() });

  await invokeTheHandler({ posthog });

  // Link one: the handler decrypted the stored credential and presented it.
  expect(posthog.eventsCalls().length).toBeGreaterThan(0);
  expect(posthog.eventsCalls()[0]?.authorization).toContain("Bearer ");

  // Links three and four: classified, then persisted, with the stamps.
  const sessions = await sessionsFor(seeded.projectId);
  expect(sessions.length).toBe(2);

  const kept = sessions.find((row) => row.sessionKey.includes(`${PREFIX}session-kept`));
  const headless = sessions.find((row) => row.sessionKey.includes(`${PREFIX}session-headless`));

  expect(kept?.exclusionReason).toBe("none");
  expect(headless?.exclusionReason).toBe("automation_headless");
  // Only the domain crosses into persistence, never the address.
  expect(kept?.identityEmailDomain).toBe(`${PREFIX}customer.example`);
  expect(kept?.identityEmailDomain).not.toContain("@");
  expect(kept?.identityResolution).toBe("resolved");
  expect(kept?.organizationId).toBe(seeded.organizationId);

  const events = await eventsFor(seeded.projectId);
  expect(events.length).toBe(3);
  expect(events.every((row) => row.organizationId === seeded.organizationId)).toBe(true);

  // Link five: the counter, read through the real service against the rows the handler
  // just wrote. This is the assertion the previous sprint's bug would have failed. A
  // computed value with no live consumer.
  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);

  expect(counter.totalReceived).toBe(3);
  expect(counter.kept).toBe(2);
  expect(setAsideCount(counter.setAside, "automation_headless")).toBe(1);
  expect(counter.droppedUnreadable).toBe(0);
  expect(counter.state.status).toBe("connected_receiving");
  // The denominator identity, on real data rather than a fixture.
  expect(
    counter.kept +
      counter.setAside.reduce((sum, row) => sum + row.count, 0) +
      counter.droppedUnreadable,
  ).toBe(counter.totalReceived);
});

// Item 116, idempotency through the real entry point

test("running the handler twice against the same upstream page yields one row per event and one session", async () => {
  const seeded = await seedConnectedWorkspace();
  const posthog = createFakePostHog({ events: () => twoSessionPage() });

  await invokeTheHandler({ posthog });
  // The claim moved `next_poll_at` forward, so the second tick is a later moment.
  // Exactly as the cron would arrive.
  await invokeTheHandler({ posthog, now: new Date(NOW.getTime() + 5 * 60_000) });

  expect(posthog.eventsCalls().length).toBeGreaterThanOrEqual(2);
  // A replayed task produces the same end state: the unique index on (project_id,
  // source_event_id) absorbs the re-query, and the session upsert is idempotent under
  // repeated application.
  expect((await eventsFor(seeded.projectId)).length).toBe(3);
  expect((await sessionsFor(seeded.projectId)).length).toBe(2);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  expect(counter.totalReceived).toBe(3);
});

// Item 117, out-of-order arrival, recovered by the overlap re-query

test("an event whose declared timestamp predates the watermark is persisted exactly once by the overlap re-query", async () => {
  // The connection has already polled up to this instant.
  const watermark = new Date(NOW.getTime() - 5 * 60_000);
  const seeded = await seedConnectedWorkspace({ watermarkAt: watermark });

  // The decisive shape the probe pinned: `timestamp` is the client-declared event time,
  // so a late-flushing SDK buffer lands an event behind the watermark. `after =
  // watermark − overlap` is the only thing that ever sees it, and no ingestion-time
  // field exists to poll on instead.
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

  // The request reached back before the watermark. Otherwise this event could never
  // have been seen at all.
  const firstAfter = new URL(posthog.eventsCalls()[0]?.url ?? "https://x.invalid").searchParams.get(
    "after",
  );
  expect(firstAfter).not.toBeNull();
  expect(Date.parse(firstAfter ?? "")).toBeLessThan(watermark.getTime());

  // Run again over the same page: the overlap re-queries it every time, and the dedup
  // key absorbs it. Exactly one row, forever.
  await invokeTheHandler({ posthog, now: new Date(NOW.getTime() + 5 * 60_000) });

  const rows = (await db.select().from(schema.events)).filter(
    (row) => row.sourceEventId === `${PREFIX}evt-backdated`,
  );
  expect(rows.length).toBe(1);
  expect(rows[0]?.occurredAt?.getTime()).toBe(backdated.getTime());
  expect(rows[0]?.projectId).toBe(seeded.projectId);
  // One session too, the re-query is absorbed by the upsert, not doubled.
  expect((await sessionsFor(seeded.projectId)).length).toBe(1);
});

// Item 118, the exclusion predicates, end to end

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

  // The stamp records its own provenance, so it stays reproducible from persisted data
  // with no upstream access.
  expect(byKey(`${PREFIX}session-internal`)?.internalDomainAtStamp).toBe(INTERNAL_DOMAIN);
  expect(sessions.every((row) => typeof row.exclusionRuleSetVersion === "number")).toBe(true);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  expect(counter.totalReceived).toBe(3);
  expect(counter.kept).toBe(1);
  expect(setAsideCount(counter.setAside, "internal_domain")).toBe(1);
  expect(setAsideCount(counter.setAside, "automation_headless")).toBe(1);
});

// Item 119, per-item degradation, surfaced in the counter

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
        // One weird item must never stall a connection forever. It is skipped, counted,
        // and surfaced, never silently discarded.
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
  // A malformed item is not a failure. The run still reaches `completed`.
  expect(runs.every((run) => run.status !== "running")).toBe(true);

  const counter = await createEventsCounterService(db, seeded.ownerCtx).read(seeded.projectId);
  expect(counter.droppedUnreadable).toBe(1);
  // And the denominator still adds up with the drop included.
  expect(
    counter.kept +
      counter.setAside.reduce((sum, row) => sum + row.count, 0) +
      counter.droppedUnreadable,
  ).toBe(counter.totalReceived);
});

// Item 120, the teammate sees what the owner sees

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

  // An org-scoped effect written by a scheduled job must be readable by every member of
  // that org, not only by whoever attached the connection. The teammate is a real
  // non-owner `member` row, so this is asserted rather than assumed.
  expect(teammateView.totalReceived).toBe(ownerView.totalReceived);
  expect(teammateView.kept).toBe(ownerView.kept);
  expect(teammateView.droppedUnreadable).toBe(ownerView.droppedUnreadable);
  expect(teammateView.setAside).toEqual(ownerView.setAside);
  expect(teammateView.state.status).toBe(ownerView.state.status);
  expect(teammateView.asOf?.getTime()).toBe(ownerView.asOf?.getTime());
  expect(teammateView.totalReceived).toBeGreaterThan(0);
});

// A guard on the proof itself: `nextCursorUrl` builds the absolute, verbatim cursor the
// server would emit, so a walk in any test above can only follow it rather than
// reconstruct it.
test("the fake cursor is an absolute url carrying an exclusive before parameter", () => {
  const cursor = new URL(
    nextCursorUrl({ sourceProjectId: "e2e-src", before: new Date("2026-07-30T17:57:49.891Z") }),
  );

  expect(cursor.protocol).toBe("https:");
  expect(cursor.searchParams.get("before")).toBe("2026-07-30T17:57:49.891000+00:00");
});
