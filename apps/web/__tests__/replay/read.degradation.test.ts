import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { findFirstProjectForOrg } from "@growthmind/db";
import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { readReplayScreen } from "../../lib/replay/read";
import {
  failingSessionRead,
  filtersOf,
  replayDeps,
  screenOf,
  seedOrgWithoutProject,
  seedReplayWorkspace,
  seedSessions,
} from "./helpers/screen";

describe("readReplayScreen — failure isolation", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  // AC-17 / D8. R1 and R2 are two reads of `sessions` issued together, R1 first; failing the
  // second is failing the lane facet. A missing count is not a wrong count, but a blanked
  // list would be a wrong screen.
  test("should keep the list and the two list facets when the lane facet read fails", async () => {
    const workspace = await seedReplayWorkspace(db, "lane-read-fails");

    await seedSessions(db, workspace, [
      { key: "ph:degrade-1", company: "acme.example", entry: "/pricing" },
      { key: "ph:degrade-2", company: "orbitlabs.example", entry: "/docs" },
    ]);

    const probe = failingSessionRead(db, 2);
    const { deps } = replayDeps(probe.db, workspace.ctx);

    const screen = screenOf(await readReplayScreen(deps, workspace.ctx, filtersOf()));

    expect(probe.sessionReads()).toBe(2);
    expect(screen.rows).toHaveLength(2);
    expect(screen.facets.company.map((option) => option.sessionCount)).toEqual([1, 1]);
    expect(screen.facets.entry.map((option) => option.sessionCount)).toEqual([1, 1]);

    expect(screen.facets.whoCounts.map((option) => option.value)).toEqual([
      "real",
      "simulated",
      "excluded",
    ]);
    expect(screen.facets.whoCounts.map((option) => option.sessionCount)).toEqual([
      null,
      null,
      null,
    ]);
  });

  // E10's retry re-runs the current query. A retry that drops you back to unfiltered is a
  // second failure, so the filters come back on the failed value.
  test("should return the failed outcome when the primary read fails", async () => {
    const workspace = await seedReplayWorkspace(db, "primary-read-fails");

    await seedSessions(db, workspace, [
      { key: "ph:failed-1", company: "acme.example", entry: "/pricing" },
    ]);

    const filters = filtersOf({ company: "acme.example", entry: "/pricing" });
    const probe = failingSessionRead(db, 1);
    const { deps } = replayDeps(probe.db, workspace.ctx);

    const result = await readReplayScreen(deps, workspace.ctx, filters);

    expect(result.kind).toBe("failed");
    expect(result).toEqual({ kind: "failed", filters });
  });

  test("should return the not-connected outcome without provisioning a project", async () => {
    const ctx = await seedOrgWithoutProject(db, "no-project");
    const { deps, sourceCalls } = replayDeps(db, ctx);

    const result = await readReplayScreen(deps, ctx, filtersOf());

    expect(result).toEqual({ kind: "not_connected" });
    // Reading must not provision: ensureProject must not appear on this path.
    expect(await findFirstProjectForOrg(db, ctx)).toBeUndefined();
    expect(sourceCalls()).toBe(0);
  });

  test("should return the not-connected outcome when the project has no active analytics connection", async () => {
    const workspace = await seedReplayWorkspace(db, "inactive-connection", {
      activeConnection: false,
    });

    await seedSessions(db, workspace, [
      { key: "ph:inactive-1", company: "acme.example", entry: "/pricing" },
    ]);

    const probe = failingSessionRead(db, 1);
    const { deps, sourceCalls } = replayDeps(probe.db, workspace.ctx);

    const result = await readReplayScreen(deps, workspace.ctx, filtersOf());

    expect(result).toEqual({ kind: "not_connected" });
    // The connection question is one query. No source object is built, and the answer is
    // reached before either session read — so the read that would have failed never ran.
    expect(sourceCalls()).toBe(0);
    expect(probe.sessionReads()).toBe(0);
  });
});
