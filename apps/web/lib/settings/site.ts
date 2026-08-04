import type { ScopedDb } from "@growthmind/db";
import { createGrowthContextRepo, describeDriverError } from "@growthmind/db";
import {
  logger,
  type IcpBeliefKind,
  type ResearchStatus,
  type TenantContext,
} from "@growthmind/shared";

export interface SiteBeliefView {
  readonly kind: IcpBeliefKind;
  readonly statement: string;

  // Null when a person told us rather than a page saying it.
  readonly readFrom: string | null;
}

export interface SiteResearchView {
  readonly domain: string | null;
  readonly status: ResearchStatus;
  readonly failure: string | null;
  readonly beliefs: readonly SiteBeliefView[];
}

const NOTHING_READ: SiteResearchView = {
  domain: null,
  status: "never_run",
  failure: null,
  beliefs: [],
};

export async function readSiteResearch(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<SiteResearchView> {
  try {
    const row = await createGrowthContextRepo(db, ctx).readSiteResearch(projectId);
    if (row === null) return NOTHING_READ;

    return {
      domain: row.siteDomain,
      status: row.researchStatus,
      failure: row.researchFailure,
      beliefs: row.icp.beliefs.map((belief) => ({
        kind: belief.kind,
        statement: belief.statement,
        readFrom: belief.provenance.citation,
      })),
    };
  } catch (error) {
    // This section failing must not take the connection and delivery controls with it.
    logger.error("settings: the site section could not be read", {
      projectId,
      reason: describeDriverError(error),
    });
    return NOTHING_READ;
  }
}
