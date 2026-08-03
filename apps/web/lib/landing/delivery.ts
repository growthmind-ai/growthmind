import type { ScopedDb } from "@growthmind/db";
import { createSlackConnectionsRepo, describeDriverError, isDeliveryTarget } from "@growthmind/db";
import type { TenantContext } from "@growthmind/shared";
import { LANDING_SETTLED_LINE, LANDING_SETTLED_NO_DELIVERY_LINE, logger } from "@growthmind/shared";

export interface LandingDeliveryDeps {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
}

// `null` is "nobody could read it". The settled line is a claim about where findings go,
// and an unreadable connection is grounds for neither half of it.
export async function readLandingDeliveryTarget(
  deps: LandingDeliveryDeps,
): Promise<boolean | null> {
  try {
    const slack = await createSlackConnectionsRepo(deps.db, deps.ctx).getActiveForOrg();

    return slack !== null && isDeliveryTarget({ channelId: slack.channelId });
  } catch (error) {
    logger.error("landing: whether what we find has anywhere to arrive could not be read", {
      organizationId: deps.ctx.organizationId,
      reason: describeDriverError(error),
    });
    return null;
  }
}

export function landingSettledLine(hasDeliveryTarget: boolean | null): string | null {
  if (hasDeliveryTarget === null) {
    return null;
  }

  return hasDeliveryTarget ? LANDING_SETTLED_LINE : LANDING_SETTLED_NO_DELIVERY_LINE;
}
