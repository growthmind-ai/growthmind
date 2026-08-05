import type { ScopedDb } from "@growthmind/db";
import { createGrowthContextRepo } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";

import { readOrFallback } from "@/lib/read-or-fallback";

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
  // This section failing must not take the connection and delivery controls with it.
  return readOrFallback(
    async () => {
      const row = await createGrowthContextRepo(db, ctx).readBusinessResearch(projectId);
      if (row === null) return NOTHING_READ;

      return {
        domain: row.siteDomain,
        status: row.researchStatus,
        failure: row.researchFailure,
        binding: toBindingLanes(row.businessContext),
        shaping: toShapingLanes(row.businessContext),
      };
    },
    NOTHING_READ,
    "settings: the business section could not be read",
    { projectId },
  );
}
