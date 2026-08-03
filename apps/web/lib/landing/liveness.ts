import type { ScopedDb } from "@growthmind/db";
import { createEventsCounterService, findFirstProjectForOrg } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";
import { describeLandingLiveness, logger } from "@growthmind/shared";

export interface LandingLivenessDeps {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly nowMs: number;
}

// A landing page that cannot read the counter still renders: the settled line
// below it is the page's job, and this sentence is the extra.
export async function readLandingLiveness(deps: LandingLivenessDeps): Promise<string | null> {
  try {
    const project = await findFirstProjectForOrg(deps.db, deps.ctx);
    if (project === undefined) return null;

    const counter = await createEventsCounterService(deps.db, deps.ctx).read(project.id);

    return describeLandingLiveness({ counter, nowMs: deps.nowMs });
  } catch (error) {
    logger.error("landing liveness: counter unreadable", { error });
    return null;
  }
}
