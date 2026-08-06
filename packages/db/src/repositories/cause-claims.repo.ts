import type { TenantContext } from "@growthmind/shared";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { CAUSE_CLAIMS_CONFLICT_TARGET, causeClaims } from "../schema/cause-claims";
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

  // Batched over citationsFor's own convention — a findings-list page renders up to
  // FINDINGS_READ_LIMIT rows, and a per-row findForFinding call there is an N+1 query.
  findForFindings(
    projectId: string,
    findingIds: readonly string[],
  ): Promise<ReadonlyMap<string, CauseClaimRecord>>;
}

function byFinding(projectId: string, findingId: string): SQL | undefined {
  return and(eq(causeClaims.projectId, projectId), eq(causeClaims.findingId, findingId));
}

function byFindings(projectId: string, findingIds: readonly string[]): SQL | undefined {
  return and(eq(causeClaims.projectId, projectId), inArray(causeClaims.findingId, [...findingIds]));
}

export function createCauseClaimsRepo(db: ScopedExecutor, ctx: TenantContext): CauseClaimsRepo {
  const c = orgCrud(db, ctx, causeClaims);

  return {
    async persist(input: PersistCauseClaimsInput): Promise<CauseClaimRecord> {
      return c.insertOrFetch(
        {
          projectId: input.projectId,
          findingId: input.findingId,
          anchorSessionId: input.anchorSessionId,
          claims: input.claims,
          droppedClaims: input.droppedClaims,
          resolvedModelId: input.resolvedModelId,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
        },
        {
          target: CAUSE_CLAIMS_CONFLICT_TARGET,
          set: {
            claims: sql`excluded.claims`,
            droppedClaims: sql`excluded.dropped_claims`,
          },
          fetch: [byFinding(input.projectId, input.findingId)],
        },
      );
    },

    async findForFinding(projectId: string, findingId: string): Promise<CauseClaimRecord | null> {
      return c.maybe(byFinding(projectId, findingId));
    },

    async findForFindings(
      projectId: string,
      findingIds: readonly string[],
    ): Promise<ReadonlyMap<string, CauseClaimRecord>> {
      if (findingIds.length === 0) {
        return new Map();
      }

      const rows = await c.list({ where: byFindings(projectId, findingIds) });
      return new Map(rows.map((row) => [row.findingId, row]));
    },
  };
}
