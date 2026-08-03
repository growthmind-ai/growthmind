import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
  type EventsSeenCounter,
  type ExclusionReason,
} from "@growthmind/shared";

import { createPollRunsRepo, type PollRunCounts } from "../../src/repositories/poll-runs.repo";
import { createEventsCounterService } from "../../src/services/events-counter.service";
import { persistPullResult, type IntakeConnection } from "../../src/services/intake.service";
import { createTestDb, type TestDb } from "../../src/testing";
import { seedConnection } from "../../src/testing";
import { sourceEvent, sourceSession, successfulPull } from "./fake-source";
import { seedWorkspace, type SeededWorkspace } from "../../src/testing";

const INTERNAL_DOMAIN = "acme-internal-example.test";
const OUTSIDE_DOMAIN = "outside-example.test";

const HEADLESS_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36";
const HEADED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const ZERO_COUNTS: PollRunCounts = {
  eventsReceived: 0,
  eventsPersisted: 0,
  eventsDroppedMalformed: 0,
  sessionsTouched: 0,
  pagesFetched: 1,
  identityLookupsUsed: 0,
};

interface CounterTarget {
  ws: SeededWorkspace;
  connection: IntakeConnection;
}

async function seedConnectedProject(
  db: TestDb,
  label: string,
  options: { watermarkAt?: Date | null } = {},
): Promise<CounterTarget> {
  const ws = await seedWorkspace(db, label);
  const row = await seedConnection(db, {
    organizationId: ws.organizationId,
    projectId: ws.project.id,
    inferredInternalDomain: INTERNAL_DOMAIN,
    watermarkAt: options.watermarkAt ?? null,
  });

  return {
    ws,
    connection: { id: row.id, projectId: ws.project.id, inferredInternalDomain: INTERNAL_DOMAIN },
  };
}

async function recordRun(
  db: TestDb,
  target: CounterTarget,
  terminal:
    | {
        kind: "completed";
        startedAt: Date;
        finishedAt: Date;
        withEvents: boolean;
        dropped?: number;
      }
    | { kind: "failed"; startedAt: Date; finishedAt: Date; dropped?: number },
): Promise<void> {
  const runs = createPollRunsRepo(db, target.ws.ctx);
  const run = await runs.start({
    projectId: target.connection.projectId,
    connectionId: target.connection.id,
    startedAt: terminal.startedAt,
  });

  if (terminal.kind === "completed") {
    await runs.finish(run.id, {
      status: "completed",
      finishedAt: terminal.finishedAt,
      outcome: terminal.withEvents ? "with_events" : "no_new_events",
      watermarkAdvancedTo: terminal.withEvents ? terminal.finishedAt : null,
      ...ZERO_COUNTS,
      eventsDroppedMalformed: terminal.dropped ?? 0,
    });
    return;
  }

  await runs.finish(run.id, {
    status: "failed",
    finishedAt: terminal.finishedAt,
    failureCode: "rate_limited",
    failureMessage: "We had to slow down and will try again shortly.",
    ...ZERO_COUNTS,
    eventsDroppedMalformed: terminal.dropped ?? 0,
  });
}

function setAsideCountFor(counter: EventsSeenCounter, reason: ExclusionReason): number {
  return counter.setAside.find((row) => row.reason === reason)?.count ?? 0;
}

function sumSetAside(counter: EventsSeenCounter): number {
  return counter.setAside.reduce((total, row) => total + row.count, 0);
}

describe("createEventsCounterService", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  async function seedMixedProject(label: string): Promise<CounterTarget> {
    const target = await seedConnectedProject(db, label, {
      watermarkAt: new Date("2026-07-30T11:45:00.000Z"),
    });

    await persistPullResult(db, target.ws.ctx, {
      connection: target.connection,
      result: successfulPull({
        sessions: [
          sourceSession({
            sessionKey: "ph:mixed-kept-a",
            identityEmailDomain: OUTSIDE_DOMAIN,
            userAgent: HEADED_UA,
          }),
          sourceSession({
            sessionKey: "ph:mixed-kept-b",
            identityEmailDomain: null,
            identityResolution: "unresolved",
            userAgent: HEADED_UA,
          }),
          sourceSession({
            sessionKey: "ph:mixed-internal",
            identityEmailDomain: INTERNAL_DOMAIN,
            userAgent: HEADED_UA,
          }),
          sourceSession({
            sessionKey: "ph:mixed-headless",
            identityEmailDomain: null,
            identityResolution: "absent",
            userAgent: HEADLESS_UA,
          }),
        ],
        events: [
          sourceEvent({ sourceEventId: "evt-mixed-1", sessionKey: "ph:mixed-kept-a" }),
          sourceEvent({ sourceEventId: "evt-mixed-2", sessionKey: "ph:mixed-kept-a" }),
          sourceEvent({ sourceEventId: "evt-mixed-3", sessionKey: "ph:mixed-kept-b" }),
          sourceEvent({ sourceEventId: "evt-mixed-4", sessionKey: "ph:mixed-internal" }),
          sourceEvent({ sourceEventId: "evt-mixed-5", sessionKey: "ph:mixed-internal" }),
          sourceEvent({ sourceEventId: "evt-mixed-6", sessionKey: "ph:mixed-headless" }),
        ],
        droppedMalformed: 2,
      }),
    });

    await recordRun(db, target, {
      kind: "completed",
      startedAt: new Date("2026-07-30T11:44:00.000Z"),
      finishedAt: new Date("2026-07-30T11:45:00.000Z"),
      withEvents: true,
      dropped: 2,
    });

    return target;
  }

  test("totalReceived equals kept plus every set-aside reason plus droppedUnreadable", async () => {
    const target = await seedMixedProject("identity");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.kept + sumSetAside(counter) + counter.droppedUnreadable).toBe(
      counter.totalReceived,
    );
  });

  test("each component of the identity is the number the pull actually produced", async () => {
    const target = await seedMixedProject("identity-components");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.kept).toBe(3);
    expect(setAsideCountFor(counter, "internal_domain")).toBe(2);
    expect(setAsideCountFor(counter, "automation_headless")).toBe(1);
    expect(counter.droppedUnreadable).toBe(2);
    expect(counter.totalReceived).toBe(8);
  });

  test("the set-aside breakdown never contains 'none' — a kept event must not be counted twice", async () => {
    const target = await seedMixedProject("no-none-row");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.setAside.map((row) => row.reason)).not.toContain("none");
  });

  test("a project with no attachment reads as not_connected", async () => {
    const ws = await seedWorkspace(db, "state-absent");

    const counter = await createEventsCounterService(db, ws.ctx).read(ws.project.id);

    expect(counter.state.status).toBe("not_connected");
    expect(counter.totalReceived).toBe(0);
    expect(counter.asOf).toBeNull();
  });

  test("an attachment that has never been polled reads as connected_never_polled with no as-of", async () => {
    const target = await seedConnectedProject(db, "state-never-polled", { watermarkAt: null });

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.state.status).toBe("connected_never_polled");
    expect(counter.totalReceived).toBe(0);

    expect(counter.asOf).toBeNull();
  });

  test("an attachment polled with nothing to show reads as connected_no_events_yet WITH an as-of", async () => {
    const target = await seedConnectedProject(db, "state-zero-events", {
      watermarkAt: new Date("2026-07-30T11:45:00.000Z"),
    });
    await recordRun(db, target, {
      kind: "completed",
      startedAt: new Date("2026-07-30T11:44:00.000Z"),
      finishedAt: new Date("2026-07-30T11:45:00.000Z"),
      withEvents: false,
    });

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.state.status).toBe("connected_no_events_yet");
    expect(counter.totalReceived).toBe(0);
    expect(counter.asOf?.toISOString()).toBe("2026-07-30T11:45:00.000Z");
  });

  test("not-connected, never-polled and polled-with-zero-events are three different answers", async () => {
    const absent = await seedWorkspace(db, "three-answers-absent");
    const neverPolled = await seedConnectedProject(db, "three-answers-never", {
      watermarkAt: null,
    });
    const zeroEvents = await seedConnectedProject(db, "three-answers-zero", {
      watermarkAt: new Date("2026-07-30T11:45:00.000Z"),
    });
    await recordRun(db, zeroEvents, {
      kind: "completed",
      startedAt: new Date("2026-07-30T11:44:00.000Z"),
      finishedAt: new Date("2026-07-30T11:45:00.000Z"),
      withEvents: false,
    });

    const statuses = [
      (await createEventsCounterService(db, absent.ctx).read(absent.project.id)).state.status,
      (
        await createEventsCounterService(db, neverPolled.ws.ctx).read(
          neverPolled.connection.projectId,
        )
      ).state.status,
      (
        await createEventsCounterService(db, zeroEvents.ws.ctx).read(
          zeroEvents.connection.projectId,
        )
      ).state.status,
    ];

    expect(new Set(statuses).size).toBe(3);
  });

  test("asOf is the completion time of the most recent SUCCESSFUL poll — not the newest event's time, and not now", async () => {
    const target = await seedConnectedProject(db, "as-of", {
      watermarkAt: new Date("2026-07-30T11:00:00.000Z"),
    });

    const newestEventAt = new Date("2026-07-30T11:45:00.000Z");
    await persistPullResult(db, target.ws.ctx, {
      connection: target.connection,
      result: successfulPull({
        sessions: [
          sourceSession({
            sessionKey: "ph:as-of-1",
            startedAt: newestEventAt,
            lastEventAt: newestEventAt,
          }),
        ],
        events: [
          sourceEvent({
            sourceEventId: "evt-as-of-1",
            sessionKey: "ph:as-of-1",
            occurredAt: newestEventAt,
          }),
        ],
      }),
    });

    await recordRun(db, target, {
      kind: "completed",
      startedAt: new Date("2026-07-30T10:59:00.000Z"),
      finishedAt: new Date("2026-07-30T11:00:00.000Z"),
      withEvents: true,
    });

    await recordRun(db, target, {
      kind: "failed",
      startedAt: new Date("2026-07-30T11:29:00.000Z"),
      finishedAt: new Date("2026-07-30T11:30:00.000Z"),
    });

    const before = new Date();
    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.asOf?.toISOString()).toBe("2026-07-30T11:00:00.000Z");
    expect(counter.asOf?.toISOString()).not.toBe("2026-07-30T11:30:00.000Z");
    expect(counter.asOf?.toISOString()).not.toBe(newestEventAt.toISOString());
    expect(counter.asOf?.getTime()).toBeLessThan(before.getTime());
  });

  test("set-aside is broken down by reason, each row carrying the customer-facing label", async () => {
    const target = await seedMixedProject("breakdown-labels");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.setAside.length).toBeGreaterThan(0);
    for (const row of counter.setAside) {
      expect(row.label).toBe(EXCLUSION_REASON_LABELS[row.reason]);
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  test("keptIdentityUnverified counts only sessions we could not check — never the ones we checked", async () => {
    const target = await seedMixedProject("unverified");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.keptIdentityUnverified).toBe(1);

    expect(counter.keptIdentityUnverified).toBeLessThanOrEqual(counter.kept);
  });

  test("a project where every session was set aside reports kept 0 with the gap fully explained", async () => {
    const target = await seedConnectedProject(db, "all-excluded", {
      watermarkAt: new Date("2026-07-30T11:45:00.000Z"),
    });

    await persistPullResult(db, target.ws.ctx, {
      connection: target.connection,
      result: successfulPull({
        sessions: [
          sourceSession({
            sessionKey: "ph:all-excluded-internal",
            identityEmailDomain: INTERNAL_DOMAIN,
            userAgent: HEADED_UA,
          }),
          sourceSession({
            sessionKey: "ph:all-excluded-headless",
            identityEmailDomain: null,
            identityResolution: "absent",
            userAgent: HEADLESS_UA,
          }),
        ],
        events: [
          sourceEvent({ sourceEventId: "evt-all-1", sessionKey: "ph:all-excluded-internal" }),
          sourceEvent({ sourceEventId: "evt-all-2", sessionKey: "ph:all-excluded-headless" }),
        ],
      }),
    });
    await recordRun(db, target, {
      kind: "completed",
      startedAt: new Date("2026-07-30T11:44:00.000Z"),
      finishedAt: new Date("2026-07-30T11:45:00.000Z"),
      withEvents: true,
    });

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.kept).toBe(0);
    expect(counter.totalReceived).toBe(2);
    expect(sumSetAside(counter)).toBe(2);

    expect(counter.setAside.length).toBeGreaterThanOrEqual(2);
  });

  test("the window is named explicitly, never implied", async () => {
    const target = await seedMixedProject("window");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.windowStatement).toBe(COUNTER_WINDOW_STATEMENT);
    expect(counter.completenessStatement).toBe(COUNTER_COMPLETENESS_STATEMENT);
    expect(counter.expectedLag.statement.length).toBeGreaterThan(0);
  });

  test("every count carries its denominator", async () => {
    const target = await seedMixedProject("denominator");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    expect(counter.totalReceived).toBeGreaterThanOrEqual(counter.kept);
    expect(counter.totalReceived).toBeGreaterThanOrEqual(sumSetAside(counter));
    expect(counter.totalReceived).toBeGreaterThanOrEqual(counter.droppedUnreadable);
    expect(counter.totalReceived).toBeGreaterThanOrEqual(counter.keptIdentityUnverified);
  });

  test("no string the counter returns claims the data is live", async () => {
    const target = await seedMixedProject("no-live-claim");

    const counter = await createEventsCounterService(db, target.ws.ctx).read(
      target.connection.projectId,
    );

    const strings = [
      counter.windowStatement,
      counter.completenessStatement,
      counter.expectedLag.statement,
      ...counter.setAside.map((row) => row.label),
    ];

    for (const value of strings) {
      expect(value).not.toMatch(/\blive\b/i);
    }
  });

  test("the aggregation scopes both sides of the join through the scope helper", () => {
    const source = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "src",
        "services",
        "events-counter.service.ts",
      ),
      "utf8",
    );

    expect(source).toContain("scoped(db, ctx)");
    expect(source).toMatch(/s\.org\(events\)/);
    expect(source).toMatch(/s\.org\(sessions\)/);
  });

  test("a second organization reading the same project id gets nothing, never the first org's numbers", async () => {
    const target = await seedMixedProject("cross-tenant");
    const other = await seedWorkspace(db, "cross-tenant-other");

    const counter = await createEventsCounterService(db, other.ctx).read(
      target.connection.projectId,
    );

    expect(counter.state.status).toBe("not_connected");
    expect(counter.totalReceived).toBe(0);
    expect(counter.kept).toBe(0);
    expect(sumSetAside(counter)).toBe(0);
    expect(counter.droppedUnreadable).toBe(0);
  });

  test("a project with zero connections is the not_connected state, distinct from a counted zero", async () => {
    const absent = await seedWorkspace(db, "zero-connections");
    const polledZero = await seedConnectedProject(db, "counted-zero", {
      watermarkAt: new Date("2026-07-30T11:45:00.000Z"),
    });
    await recordRun(db, polledZero, {
      kind: "completed",
      startedAt: new Date("2026-07-30T11:44:00.000Z"),
      finishedAt: new Date("2026-07-30T11:45:00.000Z"),
      withEvents: false,
    });

    const absentCounter = await createEventsCounterService(db, absent.ctx).read(absent.project.id);
    const zeroCounter = await createEventsCounterService(db, polledZero.ws.ctx).read(
      polledZero.connection.projectId,
    );

    expect(absentCounter.state.status).toBe("not_connected");
    expect(zeroCounter.state.status).toBe("connected_no_events_yet");

    expect(absentCounter.totalReceived).toBe(0);
    expect(zeroCounter.totalReceived).toBe(0);
    expect(absentCounter.state.status).not.toBe(zeroCounter.state.status);
  });
});
