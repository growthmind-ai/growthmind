import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import type { StampedExclusionReason, TenantContext } from "@growthmind/shared";

import { createSessionSetAsideService } from "../../src/services/session-set-aside.service";
import {
  createTestDb,
  seedConnection,
  seedOrgWithOwner,
  seedProject,
  seedSession,
  type TestDb,
} from "../../src/testing";

interface Lane {
  readonly organizationId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly ctx: TenantContext;
}

async function laneFor(db: TestDb, label: string): Promise<Lane> {
  const org = await seedOrgWithOwner(db, {
    orgName: `acme-${label}`,
    userName: `Owner ${label}`,
    email: `owner-${label}@acme.example`,
  });
  const project = await seedProject(db, {
    organizationId: org.organizationId,
    name: `checkout-${label}`,
  });
  const connection = await seedConnection(db, {
    organizationId: org.organizationId,
    projectId: project.id,
  });

  return {
    organizationId: org.organizationId,
    projectId: project.id,
    connectionId: connection.id,
    ctx: org.ctx,
  };
}

async function seedLane(
  db: TestDb,
  lane: Lane,
  reasons: readonly (readonly [StampedExclusionReason, number])[],
  version = 1,
): Promise<void> {
  let n = 0;
  for (const [reason, count] of reasons) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      // eslint-disable-next-line no-await-in-loop
      await seedSession(db, {
        organizationId: lane.organizationId,
        projectId: lane.projectId,
        connectionId: lane.connectionId,
        sessionKey: `s-${reason}-${String(version)}-${String(n)}`,
        exclusionReason: reason,
        exclusionRuleSetVersion: version,
      });
    }
  }
}

describe("the set-aside receipt counts sessions, and says out of how many", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  it("reports every set-aside reason against a total that includes what was kept", async () => {
    const lane = await laneFor(db, "receipt");
    await seedLane(db, lane, [
      ["none", 11],
      ["internal_domain", 3],
      ["automation_headless", 2],
    ]);

    const read = await createSessionSetAsideService(db, lane.ctx).read();

    expect(read.total).toBe(16);
    expect(read.kept).toBe(11);
    expect(read.setAside.map((entry) => [entry.reason, entry.count])).toEqual([
      ["internal_domain", 3],
      ["automation_headless", 2],
    ]);

    // The denominator has to be reconstructable from what the page renders, or "3 of 16" is
    // a pair of numbers a reader cannot check.
    const setAsideTotal = read.setAside.reduce((sum, entry) => sum + entry.count, 0);
    expect(read.kept + setAsideTotal).toBe(read.total);
  });

  it("never lists the kept rows as a reason, because none is not a reason", async () => {
    const lane = await laneFor(db, "kept-not-a-reason");
    await seedLane(db, lane, [["none", 4]]);

    const read = await createSessionSetAsideService(db, lane.ctx).read();

    expect(read.total).toBe(4);
    expect(read.kept).toBe(4);
    expect(read.setAside).toEqual([]);
  });

  it("names every rule version the count spans, so one sentence cannot claim them all", async () => {
    const lane = await laneFor(db, "mixed-version");
    await seedLane(db, lane, [["internal_domain", 2]], 1);
    await seedLane(db, lane, [["internal_domain", 1]], 2);

    const read = await createSessionSetAsideService(db, lane.ctx).read();

    expect(read.ruleSetVersions).toEqual([1, 2]);
    expect(read.setAside.map((entry) => [entry.reason, entry.count])).toEqual([
      ["internal_domain", 3],
    ]);
  });

  it("counts only this organization's sessions (D7)", async () => {
    const ours = await laneFor(db, "ours");
    const theirs = await laneFor(db, "theirs");

    await seedLane(db, ours, [["none", 2]]);
    await seedLane(db, theirs, [
      ["none", 50],
      ["internal_domain", 50],
    ]);

    const read = await createSessionSetAsideService(db, ours.ctx).read();

    expect(read.total).toBe(2);
    expect(read.setAside).toEqual([]);
  });

  it("answers zero rather than throwing for a workspace that has never been polled", async () => {
    const lane = await laneFor(db, "never-polled");

    const read = await createSessionSetAsideService(db, lane.ctx).read();

    expect(read).toEqual({ total: 0, kept: 0, setAside: [], ruleSetVersions: [] });
  });
});
