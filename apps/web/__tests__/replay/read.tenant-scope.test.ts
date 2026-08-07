import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestDb, type TestDb } from "@growthmind/db/testing";
import type { ReplayFilters } from "@growthmind/shared";

import { readReplayScreen, type ReplayScreen } from "../../lib/replay/read";
import {
  filtersOf,
  replayDeps,
  screenOf,
  seedReplayWorkspace,
  seedSessions,
  seedTeammate,
} from "./helpers/screen";

// A9/AC-7: the organization is resolved from the session, never taken from the filter. Stated
// as a type so a build that adds an org field to the reader's input fails to compile.
type TenantKeyIn<T> = Extract<keyof T, "organizationId" | "organization" | "orgId" | "tenant">;

const FILTERS_CARRY_NO_ORGANIZATION: [TenantKeyIn<ReplayFilters>] extends [never] ? true : false =
  true;

function shapeOf(result: ReplayScreen): unknown {
  const view = screenOf(result);

  return { rows: view.rows, outcome: view.outcome, provenance: view.provenance };
}

describe("readReplayScreen — tenant scope", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });

  afterAll(async () => {
    await close();
  });

  test("should return empty rows when org B filters to org A's domain", async () => {
    const orgA = await seedReplayWorkspace(db, "leak-a");
    const orgB = await seedReplayWorkspace(db, "leak-b");

    await seedSessions(db, orgA, [
      { key: "ph:orga-pricing", company: "orga-only.example", entry: "/orga-pricing" },
    ]);
    await seedSessions(db, orgB, [
      { key: "ph:orgb-pricing", company: "orgb-only.example", entry: "/orgb-pricing" },
    ]);

    const { deps } = replayDeps(db, orgB.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, orgB.ctx, filtersOf({ company: "orga-only.example" })),
    );

    expect(screen.rows).toHaveLength(0);

    const everyOptionValue = [
      ...screen.facets.company.map((option) => option.value),
      ...screen.facets.entry.map((option) => option.value),
    ];
    expect(everyOptionValue).not.toContain("orga-only.example");
    expect(everyOptionValue).not.toContain("/orga-pricing");
  });

  test("should never take an organization id from its filter input", async () => {
    expect(FILTERS_CARRY_NO_ORGANIZATION).toBe(true);

    const orgA = await seedReplayWorkspace(db, "no-org-field-a");
    const orgB = await seedReplayWorkspace(db, "no-org-field-b");

    await seedSessions(db, orgB, [
      { key: "ph:orgb-only", company: "orgb-only.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, orgA.ctx);

    const screen = screenOf(
      await readReplayScreen(deps, orgA.ctx, filtersOf({ company: "orgb-only.example" })),
    );

    expect(screen.rows).toHaveLength(0);
  });

  // A10: three different causes, one shape. A probe that could tell them apart would be
  // telling the caller that a domain exists in some other organization.
  test("should render one identical shape for a guessed domain, a cross-org domain and a domain that aged out", async () => {
    const orgA = await seedReplayWorkspace(db, "one-shape-a");
    const orgB = await seedReplayWorkspace(db, "one-shape-b");

    await seedSessions(db, orgA, [
      { key: "ph:one-shape-real", company: "acme.example", entry: "/pricing" },
      // Held, but not in what this screen reads — the aged-out case, modelled through the
      // lane rather than through a deletion this workspace cannot express.
      {
        key: "ph:one-shape-old",
        company: "aged-out.example",
        entry: "/pricing",
        origin: "synthetic",
      },
    ]);
    await seedSessions(db, orgB, [
      { key: "ph:one-shape-orgb", company: "orgb-only.example", entry: "/pricing" },
    ]);

    const { deps } = replayDeps(db, orgA.ctx);

    const guessed = await readReplayScreen(deps, orgA.ctx, filtersOf({ company: "acme.exmaple" }));
    const crossOrg = await readReplayScreen(
      deps,
      orgA.ctx,
      filtersOf({ company: "orgb-only.example" }),
    );
    const agedOut = await readReplayScreen(
      deps,
      orgA.ctx,
      filtersOf({ company: "aged-out.example" }),
    );

    expect(shapeOf(crossOrg)).toEqual(shapeOf(guessed));
    expect(shapeOf(agedOut)).toEqual(shapeOf(guessed));
  });

  test("should return the identical rows and counts for a teammate in the same org", async () => {
    const workspace = await seedReplayWorkspace(db, "teammate");

    await seedSessions(db, workspace, [
      { key: "ph:shared-1", company: "acme.example", entry: "/pricing" },
      { key: "ph:shared-2", company: "acme.example", entry: "/docs" },
    ]);

    const teammate = await seedTeammate(db, workspace);

    const owner = screenOf(
      await readReplayScreen(replayDeps(db, workspace.ctx).deps, workspace.ctx, filtersOf()),
    );
    const member = screenOf(
      await readReplayScreen(replayDeps(db, teammate).deps, teammate, filtersOf()),
    );

    expect(member.rows).toEqual(owner.rows);
    expect(member.facets).toEqual(owner.facets);
    expect(member.provenance).toEqual(owner.provenance);
  });
});
