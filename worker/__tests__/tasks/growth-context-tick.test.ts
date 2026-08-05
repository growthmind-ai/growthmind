import { URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { growthContext, type SurfaceObservation } from "@growthmind/core";
import type { GrowthContextRepo, GrowthContextSnapshot } from "@growthmind/db";
import { describe, expect, test } from "bun:test";

import {
  growthContextWindowStart,
  runGrowthContextTick,
  type GrowthContextLane,
  type GrowthContextTickDeps,
} from "../../src/tasks/growth-context-tick";

const NOW = new Date("2026-08-04T03:30:00.000Z");

const CTX = {
  userId: "system",
  organizationId: "org-1",
  organizationName: "Acme",
  role: "system",
} as unknown as GrowthContextLane["ctx"];

function lane(projectId: string): GrowthContextLane {
  return { organizationId: "org-1", projectId, ctx: CTX };
}

function observation(overrides: Partial<SurfaceObservation> = {}): SurfaceObservation {
  return {
    surface: "/checkout",
    normalisationVersion: URL_PATH_NORMALISATION_VERSION,
    sessions: 100,
    firstSessionVisitsByReturners: 0,
    visitsByReturningIdentities: 0,
    sessionsAlsoReachingMoney: 0,
    ...overrides,
  };
}

interface Recorded {
  readonly writes: { projectId: string; surfaces: unknown }[];
  readonly logged: string[];
}

function depsFor(input: {
  readonly lanes: readonly GrowthContextLane[];
  readonly observations?: readonly SurfaceObservation[];
  readonly snapshot?: GrowthContextSnapshot | null;
  readonly written?: boolean;
  readonly observeThrows?: boolean;
}): { deps: GrowthContextTickDeps; recorded: Recorded } {
  const recorded: Recorded = { writes: [], logged: [] };

  const repo = {
    snapshotForProject: () => Promise.resolve(input.snapshot ?? null),
    saveIfUnchanged: (saved: { projectId: string; surfaces: unknown }) => {
      recorded.writes.push({ projectId: saved.projectId, surfaces: saved.surfaces });
      return Promise.resolve(input.written ?? true);
    },
    findForProject: () => Promise.resolve(null),
    findForProjects: () => Promise.resolve(new Map()),
    save: () => Promise.reject(new Error("the tick must use the guarded write")),
  } as unknown as GrowthContextRepo;

  return {
    deps: {
      lanes: { listLanes: () => Promise.resolve(input.lanes) },
      observationsFor: () => ({
        observe: () =>
          input.observeThrows
            ? Promise.reject(new Error("the events query fell over"))
            : Promise.resolve(input.observations ?? []),
      }),
      growthFor: () => repo,
      now: () => NOW,
      logger: {
        info: (message: string) => recorded.logged.push(message),
        warn: (message: string) => recorded.logged.push(message),
        error: (message: string) => recorded.logged.push(message),
      },
    },
    recorded,
  };
}

describe("growth context tick", () => {
  test("writes a page's purpose the first time it can work one out", async () => {
    const { deps, recorded } = depsFor({
      lanes: [lane("project-1")],
      observations: [observation()],
    });

    const summary = await runGrowthContextTick(deps);

    expect(summary.updated).toBe(1);
    expect(recorded.writes).toHaveLength(1);
  });

  test("writes nothing when it works out the same answer as last time", async () => {
    // Graphile replays a task on retry, and a daily run mostly re-derives what is already
    // there. Neither may churn the row.
    const existing = growthContext({
      surfaces: [
        {
          surface: "/checkout",
          role: "makes_money",
          basis: "derived_from_product",
          confirmedAt: null,
          normalisationVersion: URL_PATH_NORMALISATION_VERSION,
        },
      ],
      confirmedChangeable: [],
    });

    const { deps, recorded } = depsFor({
      lanes: [lane("project-1")],
      observations: [observation()],
      snapshot: { context: existing, updatedAt: new Date("2026-08-03T03:30:00.000Z") },
    });

    const summary = await runGrowthContextTick(deps);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
    expect(recorded.writes).toEqual([]);
  });

  test("reports nothing written when the row moved under it", async () => {
    const { deps } = depsFor({
      lanes: [lane("project-1")],
      observations: [observation()],
      written: false,
    });

    const summary = await runGrowthContextTick(deps);

    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
  });

  test("one project failing does not cost every other project its weighting", async () => {
    const { deps, recorded } = depsFor({
      lanes: [lane("project-1")],
      observeThrows: true,
    });

    const summary = await runGrowthContextTick(deps);

    expect(summary.lanesErrored).toBe(1);
    expect(recorded.writes).toEqual([]);
    expect(recorded.logged.some((line) => line.includes("could not be weighted"))).toBe(true);
  });

  test("does nothing at all when no project is connected", async () => {
    const { deps, recorded } = depsFor({ lanes: [] });

    const summary = await runGrowthContextTick(deps);

    expect(summary).toMatchObject({ lanesConsidered: 0, updated: 0, lanesErrored: 0 });
    expect(recorded.writes).toEqual([]);
  });
});

describe("growthContextWindowStart", () => {
  test("looks back a fixed window, so a role rests on recent behaviour", () => {
    expect(growthContextWindowStart(NOW).toISOString()).toBe("2026-07-05T03:30:00.000Z");
  });
});
