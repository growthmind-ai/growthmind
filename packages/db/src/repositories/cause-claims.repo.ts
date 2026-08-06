import type { TenantContext } from "@growthmind/shared";
import { and, eq, type SQL } from "drizzle-orm";

import { causeClaims } from "../schema/cause-claims";
import { orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

export type CauseClaimRecord = typeof causeClaims.$inferSelect;

export interface CauseClaimStatement {
  readonly statement: string;
  readonly citesBeats: readonly number[];
}

// `organizationId` is stamped by orgCrud from the caller's own TenantContext, never accepted
// here — the same "excluded at the type level" guarantee divergence-points.repo.ts's
// RecordDivergenceInput gives.
export interface PersistCauseClaimsInput {
  readonly projectId: string;
  readonly findingId: string;
  readonly anchorSessionId: string;
  readonly claims: readonly CauseClaimStatement[];
  readonly droppedClaims: number;
  readonly resolvedModelId: string | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface CauseClaimsRepo {
  persist(input: PersistCauseClaimsInput): Promise<CauseClaimRecord>;

  findForFinding(projectId: string, findingId: string): Promise<CauseClaimRecord | null>;
}

function byFinding(projectId: string, findingId: string): SQL | undefined {
  return and(eq(causeClaims.projectId, projectId), eq(causeClaims.findingId, findingId));
}

export function createCauseClaimsRepo(db: ScopedExecutor, ctx: TenantContext): CauseClaimsRepo {
  const c = orgCrud(db, ctx, causeClaims);

  return {
    async persist(input: PersistCauseClaimsInput): Promise<CauseClaimRecord> {
      return c.insert({
        projectId: input.projectId,
        findingId: input.findingId,
        anchorSessionId: input.anchorSessionId,
        claims: input.claims,
        droppedClaims: input.droppedClaims,
        resolvedModelId: input.resolvedModelId,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
      });
    },

    async findForFinding(projectId: string, findingId: string): Promise<CauseClaimRecord | null> {
      return c.maybe(byFinding(projectId, findingId));
    },
  };
}
