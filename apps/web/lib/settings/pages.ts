import { isProposableSurface, proposalScopeOf } from "@growthmind/core";
import type { ScopedDb } from "@growthmind/db";
import { createGrowthContextRepo, describeDriverError } from "@growthmind/db";
import { logger, type SurfaceRole, type TenantContext } from "@growthmind/shared";

export interface PageRoleView {
  readonly surface: string;
  readonly role: SurfaceRole;

  readonly statedByAPerson: boolean;

  // False for the pages §5 refuses. The checkbox that overrides it is only offered on these,
  // because offering it everywhere would invite a decision nobody needs to make.
  readonly offLimits: boolean;

  readonly changeable: boolean;
}

export async function readPageRoles(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<readonly PageRoleView[]> {
  let context;
  try {
    context = await createGrowthContextRepo(db, ctx).findForProject(projectId);
  } catch (error) {
    // This section failing must not take the rest of settings with it — the connection and
    // delivery controls above it are what someone mid-setup actually came for.
    logger.error("settings: the pages section could not be read", {
      projectId,
      reason: describeDriverError(error),
    });
    return [];
  }

  if (context === null) {
    return [];
  }

  const scope = proposalScopeOf(context);

  return [...context.bySurface.values()]
    .toSorted((left, right) => left.surface.localeCompare(right.surface))
    .map((roled) => {
      const changeable = scope.confirmedChangeable.has(roled.surface);

      return {
        surface: roled.surface,
        role: roled.role,
        statedByAPerson: roled.confirmedAt !== null,
        // Asked without the override, so the answer is whether §5 refuses this page at all
        // rather than whether it currently happens to be allowed.
        offLimits: !isProposableSurface(roled.surface, { confirmedChangeable: new Set() })
          .proposable,
        changeable,
      };
    });
}
