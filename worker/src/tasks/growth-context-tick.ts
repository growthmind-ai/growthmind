import { deriveRoledSurfaces, type RoledSurface } from "@growthmind/core";
import type { GrowthContextRepo, SurfaceObservationsService } from "@growthmind/db";
import { describeDriverError } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";

import type { TaskLogger } from "../task-logger";

export const GROWTH_CONTEXT_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export function growthContextWindowStart(at: Date): Date {
  return new Date(at.getTime() - GROWTH_CONTEXT_WINDOW_DAYS * MS_PER_DAY);
}

export interface GrowthContextLane {
  readonly organizationId: string;
  readonly projectId: string;
  readonly ctx: TenantContext;
}

export interface GrowthContextLaneSource {
  listLanes(): Promise<readonly GrowthContextLane[]>;
}

export interface GrowthContextTickDeps {
  readonly lanes: GrowthContextLaneSource;
  readonly observationsFor: (ctx: TenantContext) => SurfaceObservationsService;
  readonly growthFor: (ctx: TenantContext) => GrowthContextRepo;
  readonly now: () => Date;
  readonly logger: TaskLogger;
}

export interface GrowthContextTickSummary {
  lanesConsidered: number;
  updated: number;
  unchanged: number;
  lanesErrored: number;
}

const roleKey = (roled: RoledSurface): string =>
  `${roled.surface}|${roled.role}|${roled.basis}|${String(roled.normalisationVersion)}|${roled.confirmedAt?.toISOString() ?? ""}`;

function sameRoles(left: readonly RoledSurface[], right: readonly RoledSurface[]): boolean {
  if (left.length !== right.length) return false;

  const before = left.map(roleKey).toSorted();
  const after = right.map(roleKey).toSorted();

  return before.every((entry, index) => entry === after[index]);
}

async function runLane(deps: GrowthContextTickDeps, lane: GrowthContextLane): Promise<boolean> {
  const growth = deps.growthFor(lane.ctx);
  const snapshot = await growth.snapshotForProject(lane.projectId);

  const observations = await deps.observationsFor(lane.ctx).observe({
    projectId: lane.projectId,
    since: growthContextWindowStart(deps.now()),
  });

  const before = [...(snapshot?.context.bySurface.values() ?? [])];
  const derived = deriveRoledSurfaces({
    observations,
    existing: before,
    derivedAt: deps.now(),
  });

  if (sameRoles(before, derived)) {
    return false;
  }

  // Everything above was decided from the row read at the top of this function, and a person
  // confirming a role in the meantime writes to that same row. Checking the stamp is what
  // stops this run deriving their answer away.
  const written = await growth.saveIfUnchanged(
    {
      projectId: lane.projectId,
      // A person's own answer to §5, never derived, so it is carried through untouched.
      surfaces: derived,
      confirmedChangeable: [...(snapshot?.context.confirmedChangeable ?? [])],
    },
    snapshot?.updatedAt ?? null,
  );

  if (!written) {
    deps.logger.info(
      `growth context: project ${lane.projectId} was changed by someone while this run was working it out, ` +
        `so nothing was written and the next run will start from what they said`,
    );
    return false;
  }

  deps.logger.info(
    `growth context: project ${lane.projectId} now has ${String(derived.length)} pages with a stated purpose, ` +
      `${String(derived.filter((roled) => roled.confirmedAt !== null).length)} of them confirmed by a person`,
  );

  return true;
}

export async function runGrowthContextTick(
  deps: GrowthContextTickDeps,
): Promise<GrowthContextTickSummary> {
  const lanes = await deps.lanes.listLanes();

  const summary: GrowthContextTickSummary = {
    lanesConsidered: lanes.length,
    updated: 0,
    unchanged: 0,
    lanesErrored: 0,
  };

  for (const lane of lanes) {
    try {
      if (await runLane(deps, lane)) {
        summary.updated += 1;
      } else {
        summary.unchanged += 1;
      }
    } catch (error) {
      // One project's weighting failing must not cost every other project theirs.
      deps.logger.error(
        `growth context: project ${lane.projectId} could not be weighted this run — ${describeDriverError(error)}`,
      );
      summary.lanesErrored += 1;
    }
  }

  deps.logger.info(
    `growth context: lanes ${String(summary.lanesConsidered)}, updated ${String(summary.updated)}, ` +
      `unchanged ${String(summary.unchanged)}, errored ${String(summary.lanesErrored)}`,
  );

  return summary;
}
