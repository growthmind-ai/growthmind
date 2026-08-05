import type { ScopedDb } from "@growthmind/db";
import { createGrowthContextRepo, describeDriverError } from "@growthmind/db";
import { logger, type TenantContext } from "@growthmind/shared";

import {
  NOTHING_READ,
  toBindingLanes,
  toShapingLanes,
  type BusinessResearchView,
} from "./business";

export async function readBusinessResearch(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<BusinessResearchView> {
  try {
    const row = await createGrowthContextRepo(db, ctx).readBusinessResearch(projectId);
    if (row === null) return NOTHING_READ;

    return {
      domain: row.siteDomain,
      status: row.researchStatus,
      failure: row.researchFailure,
      binding: toBindingLanes(row.businessContext),
      shaping: toShapingLanes(row.businessContext),
    };
  } catch (error) {
    // This section failing must not take the connection and delivery controls with it.
    logger.error("settings: the business section could not be read", {
      projectId,
      reason: describeDriverError(error),
    });
    return NOTHING_READ;
  }
}
