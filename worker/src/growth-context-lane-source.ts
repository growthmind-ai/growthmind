import type { ScopedDb } from "@growthmind/db";
import { describeDriverError } from "@growthmind/db";
import { SYSTEM_ACTOR, listAnalysableProjects, systemContextFor } from "@growthmind/db/system";

import type { TaskLogger } from "./task-logger";
import type { GrowthContextLane, GrowthContextLaneSource } from "./tasks/growth-context-tick";

export interface GrowthContextLaneSourceDeps {
  readonly db: ScopedDb;
  readonly logger: TaskLogger;
}

// The same project set the analysis tick works: a project with no active connection produces
// no findings, so weighting one would order a queue that never fills.
export function createGrowthContextLaneSource(
  deps: GrowthContextLaneSourceDeps,
): GrowthContextLaneSource {
  return {
    async listLanes(): Promise<readonly GrowthContextLane[]> {
      const projects = await listAnalysableProjects(deps.db);
      const lanes: GrowthContextLane[] = [];

      for (const project of projects) {
        try {
          lanes.push({
            organizationId: project.organizationId,
            projectId: project.projectId,
            ctx: systemContextFor(SYSTEM_ACTOR.GROWTH_CONTEXT_TICK, project),
          });
        } catch (error) {
          // `systemContextFor` refuses a malformed row. One of those must not cost every
          // other project its weighting.
          deps.logger.error(
            `growth context lane source: skipping project ${project.projectId} this run: ` +
              `${describeDriverError(error)}`,
          );
        }
      }

      return lanes;
    },
  };
}
