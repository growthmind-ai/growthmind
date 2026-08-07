import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";

import { readReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  outcomeName,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
  type Workspace,
} from "./helpers/screen";

// acme.com is only ever seen at /pricing and orbitlabs.co.uk only at /docs, so each is a
// company with zero sessions under the other's entry path — the shape AC-3 is about.
async function seedTwoCompanies(db: TestDb, label: string): Promise<Workspace> {
  const workspace = await seedReplayWorkspace(db, label);

  await seedSessions(db, workspace, [
    { key: "ph:acme-pricing-1", company: "acme.com", entry: "/pricing" },
    { key: "ph:acme-pricing-2", company: "acme.com", entry: "/pricing" },
    { key: "ph:orbit-docs-1", company: "orbitlabs.co.uk", entry: "/docs" },
    { key: "ph:orbit-docs-2", company: "orbitlabs.co.uk", entry: "/docs" },
  ]);

  return workspace;
}

describe("readReplayScreen — conditioned counts", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("should carry an option reading 0 for a company with no sessions at the active entry path, present and pickable", async () => {
    const workspace = await seedTwoCompanies(db, "zero-option");
    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ entry: "/pricing" })),
    );

    // By row count over the array, never by lookup: a build that drops the row entirely
    // satisfies every assertion that only inspects the option it finds.
    expect(screen.facets.company).toHaveLength(2);
    expect(screen.facets.company.filter((option) => option.value === "orbitlabs.co.uk")).toEqual([
      { value: "orbitlabs.co.uk", sessionCount: 0, replayCount: 0 },
    ]);
  });

  test("should still return a valid screen when that zero option is applied", async () => {
    const workspace = await seedTwoCompanies(db, "zero-applied");
    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(
        deps,
        workspace.ctx,
        filtersOf({ company: "orbitlabs.co.uk", entry: "/pricing" }),
      ),
    );

    expect(screen.rows).toHaveLength(0);
    expect(["value_matches_nothing", "zero_replays_for_selection"]).toContain(
      outcomeName(screen.outcome),
    );
  });

  test("should keep the company facet's option count unchanged as the entry filter changes", async () => {
    const workspace = await seedTwoCompanies(db, "stable-universe");
    const { deps } = replayDeps(db, workspace.ctx);

    const atPricing = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ entry: "/pricing" })),
    );
    const atDocs = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ entry: "/docs" })),
    );

    expect(atDocs.facets.company).toHaveLength(atPricing.facets.company.length);
    expect(atDocs.facets.company.map((option) => option.value)).toEqual(
      atPricing.facets.company.map((option) => option.value),
    );
    expect(atDocs.facets.company.map((option) => option.sessionCount)).not.toEqual(
      atPricing.facets.company.map((option) => option.sessionCount),
    );
  });

  test("should read 0 on an entry option for a path the active company never used", async () => {
    const workspace = await seedTwoCompanies(db, "mirrored-gate");
    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, workspace.ctx, filtersOf({ company: "acme.com" })),
    );

    expect(screen.facets.entry).toHaveLength(2);
    expect(screen.facets.entry.filter((option) => option.value === "/docs")).toEqual([
      { value: "/docs", sessionCount: 0, replayCount: 0 },
    ]);
  });

  test("should count all three lanes under the active company and entry", async () => {
    const workspace = await seedReplayWorkspace(db, "who-counts");

    await seedSessions(db, workspace, [
      { key: "ph:who-real-1", company: "acme.com", entry: "/pricing" },
      { key: "ph:who-real-2", company: "acme.com", entry: "/pricing" },
      { key: "ph:who-sim", company: "acme.com", entry: "/pricing", origin: "synthetic" },
      {
        key: "ph:who-excluded",
        company: "acme.com",
        entry: "/pricing",
        exclusionReason: "internal_domain",
      },
      { key: "ph:who-elsewhere", company: "orbitlabs.co.uk", entry: "/docs" },
    ]);

    const { deps } = replayDeps(db, workspace.ctx);

    const screen = screenOf(
      await readReplayScreen(
        deps,
        workspace.ctx,
        filtersOf({ company: "acme.com", entry: "/pricing" }),
      ),
    );

    expect(screen.facets.whoCounts.map((option) => [option.value, option.sessionCount])).toEqual([
      ["real", 2],
      ["simulated", 1],
      ["excluded", 1],
    ]);
  });
});
