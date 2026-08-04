import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSurfaceObservationsService } from "../../src/services/surface-observations.service";
import { createTestDb, type TestDb } from "../../src/testing";
import {
  laneNames,
  seedEvents,
  seedOrgWithOwner,
  seedProject,
  seedConnection,
  seedSession,
  type SeededOrgWithOwner,
} from "../../src/testing";

const NAMES = laneNames("surface-observations");

const SINCE = new Date("2026-07-01T00:00:00.000Z");
const DAY_ONE = new Date("2026-07-20T10:00:00.000Z");
const DAY_TWO = new Date("2026-07-25T10:00:00.000Z");

interface Lane {
  readonly org: SeededOrgWithOwner;
  readonly projectId: string;
  readonly connectionId: string;
}

async function seedLane(db: TestDb, label: string): Promise<Lane> {
  const org = await seedOrgWithOwner(db, {
    orgName: NAMES.orgName(label),
    userName: NAMES.userName(label),
    email: NAMES.email(label),
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: NAMES.projectName(label),
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
  });

  return { org, projectId: project.id, connectionId: connection.id };
}

let sessionCounter = 0;

async function seedVisit(
  db: TestDb,
  lane: Lane,
  input: {
    readonly surfaces: readonly string[];
    readonly identityKey?: string | null;
    readonly startedAt?: Date;
    readonly exclusionReason?: "none" | "internal_domain";
    readonly origin?: "real" | "synthetic";
  },
): Promise<void> {
  sessionCounter += 1;
  const sessionKey = `${lane.projectId}-visit-${String(sessionCounter)}`;

  const session = await seedSession(db, {
    organizationId: lane.org.organizationId,
    projectId: lane.projectId,
    connectionId: lane.connectionId,
    sessionKey,
    identityKey: input.identityKey ?? null,
    identityResolution: input.identityKey ? "resolved" : "absent",
    startedAt: input.startedAt ?? DAY_ONE,
    exclusionReason: input.exclusionReason ?? "none",
    origin: input.origin ?? "real",
  });

  await seedEvents(
    db,
    input.surfaces.map((surface, index) => ({
      organizationId: lane.org.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionId: session.id,
      sourceEventId: `${sessionKey}-${String(index)}`,
      urlPath: surface,
      occurredAt: new Date((input.startedAt ?? DAY_ONE).getTime() + index * 1_000),
    })),
  );
}

async function observe(db: TestDb, lane: Lane) {
  const rows = await createSurfaceObservationsService(db, lane.org.ctx).observe({
    projectId: lane.projectId,
    since: SINCE,
  });

  return new Map(rows.map((row) => [row.surface, row]));
}

describe("surface observations", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("counts one visit per session, however many events that page fired", async () => {
    // A page firing six events per view must not outrank one firing a single event.
    const lane = await seedLane(db, "per-session");
    await seedVisit(db, lane, { surfaces: ["/reports", "/reports", "/reports"] });
    await seedVisit(db, lane, { surfaces: ["/reports"] });

    expect((await observe(db, lane)).get("/reports")?.sessions).toBe(2);
  });

  it("leaves out the team's own visits, so a role is never derived from them", async () => {
    // §4. Internal traffic is where a founder's own clicking would otherwise define
    // what the product is for.
    const lane = await seedLane(db, "internal");
    await seedVisit(db, lane, { surfaces: ["/reports"] });
    await seedVisit(db, lane, { surfaces: ["/reports"], exclusionReason: "internal_domain" });
    await seedVisit(db, lane, { surfaces: ["/reports"], exclusionReason: "internal_domain" });

    expect((await observe(db, lane)).get("/reports")?.sessions).toBe(1);
  });

  it("leaves out simulated traffic", async () => {
    const lane = await seedLane(db, "synthetic");
    await seedVisit(db, lane, { surfaces: ["/reports"] });
    await seedVisit(db, lane, { surfaces: ["/reports"], origin: "synthetic" });

    expect((await observe(db, lane)).get("/reports")?.sessions).toBe(1);
  });

  it("counts a visit by someone who came back, only when they came back", async () => {
    const lane = await seedLane(db, "returners");

    await seedVisit(db, lane, {
      surfaces: ["/reports"],
      identityKey: "who-returns",
      startedAt: DAY_ONE,
    });
    await seedVisit(db, lane, {
      surfaces: ["/reports"],
      identityKey: "who-returns",
      startedAt: DAY_TWO,
    });
    await seedVisit(db, lane, { surfaces: ["/reports"], identityKey: "who-does-not" });

    const seen = (await observe(db, lane)).get("/reports");

    expect(seen?.sessions).toBe(3);
    expect(seen?.visitsByReturningIdentities).toBe(2);
  });

  it("counts a first visit only for someone who later came back", async () => {
    const lane = await seedLane(db, "first-visit");

    await seedVisit(db, lane, {
      surfaces: ["/welcome"],
      identityKey: "returner",
      startedAt: DAY_ONE,
    });
    await seedVisit(db, lane, {
      surfaces: ["/reports"],
      identityKey: "returner",
      startedAt: DAY_TWO,
    });
    await seedVisit(db, lane, { surfaces: ["/welcome"], identityKey: "one-timer" });

    const seen = await observe(db, lane);

    expect(seen.get("/welcome")?.firstSessionVisitsByReturners).toBe(1);
    expect(seen.get("/reports")?.firstSessionVisitsByReturners).toBe(0);
  });

  it("counts the sessions that also reached a page where money changes hands", async () => {
    const lane = await seedLane(db, "with-money");

    await seedVisit(db, lane, { surfaces: ["/plans", "/checkout"] });
    await seedVisit(db, lane, { surfaces: ["/plans"] });

    const seen = await observe(db, lane);

    expect(seen.get("/plans")?.sessions).toBe(2);
    expect(seen.get("/plans")?.sessionsAlsoReachingMoney).toBe(1);
  });

  it("leaves out a page spelled by a normaliser this build no longer uses", async () => {
    const lane = await seedLane(db, "stale-normaliser");
    const session = await seedSession(db, {
      organizationId: lane.org.organizationId,
      projectId: lane.projectId,
      connectionId: lane.connectionId,
      sessionKey: `${lane.projectId}-stale`,
    });

    await seedEvents(db, [
      {
        organizationId: lane.org.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionId: session.id,
        sourceEventId: `${lane.projectId}-stale-0`,
        urlPath: "/reports",
        urlPathNormalisationVersion: 1,
      },
    ]);

    expect((await observe(db, lane)).has("/reports")).toBe(false);
  });

  it("does not observe another organization's traffic", async () => {
    const mine = await seedLane(db, "tenant-mine");
    const theirs = await seedLane(db, "tenant-theirs");

    await seedVisit(db, theirs, { surfaces: ["/theirs-only"] });

    const seen = await createSurfaceObservationsService(db, mine.org.ctx).observe({
      projectId: theirs.projectId,
      since: SINCE,
    });

    expect(seen).toEqual([]);
  });

  it("does not count another organization's money pages against this one", async () => {
    // The money predicate is an `or` chain sitting beside the organization `and`s. Unwrapped
    // it reads as `(org and … and like_a) or like_b or …`, and every visit to anyone's
    // /checkout anywhere counts here. A same-surface fixture in a second organization is the
    // only shape that shows it.
    const mine = await seedLane(db, "money-mine");
    const theirs = await seedLane(db, "money-theirs");

    await seedVisit(db, mine, { surfaces: ["/plans"] });
    await seedVisit(db, theirs, { surfaces: ["/plans", "/checkout"] });

    const seen = await observe(db, mine);

    expect(seen.get("/plans")?.sessions).toBe(1);
    expect(seen.get("/plans")?.sessionsAlsoReachingMoney).toBe(0);
    expect(seen.has("/checkout")).toBe(false);
  });

  it("answers nothing for a project with no traffic at all", async () => {
    const lane = await seedLane(db, "silent");

    expect(
      await createSurfaceObservationsService(db, lane.org.ctx).observe({
        projectId: lane.projectId,
        since: SINCE,
      }),
    ).toEqual([]);
  });
});
