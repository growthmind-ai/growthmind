import type { TenantContext } from "@growthmind/shared";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";

import { divergencePoints, DIVERGENCE_POINTS_CONFLICT_TARGET } from "../schema/divergence-points";
import { orgCrud } from "./crud";
import type { ScopedExecutor } from "./types";

export type DivergencePointRecord = typeof divergencePoints.$inferSelect;

// Plain field types, not `OrgInsertValues<typeof divergencePoints>` — the insert-value
// type admits raw SQL/Placeholder per column (drizzle's generic escape hatch), which
// would leak into every caller's hand of `input.surface` etc. as a union instead of
// `string`. `organizationId` is simply absent from this interface, which is the same
// "excluded at the type level" guarantee `OrgInsertValues` gives sibling repos, without
// widening every other field.
export interface RecordDivergenceInput {
  readonly projectId: string;
  readonly surface: string;
  readonly surfaceNormalisationVersion: number | null;
  readonly spineVersion: number;
  readonly cohortMatchVersion: number;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly kind: DivergencePointRecord["kind"];
  readonly divergedAtRank: number | null;
  readonly reason: DivergencePointRecord["reason"];
  readonly succeededCohortSize: number;
  readonly failedCohortSize: number;
  readonly succeededSessionIdsSample: readonly string[];
  readonly failedSessionIdsSample: readonly string[];
}

export interface DivergencePointsRepo {
  recordDivergence(input: RecordDivergenceInput): Promise<DivergencePointRecord>;

  findBySurface(projectId: string, surface: string): Promise<DivergencePointRecord | null>;
}

function bySurface(projectId: string, surface: string): SQL | undefined {
  return and(eq(divergencePoints.projectId, projectId), eq(divergencePoints.surface, surface));
}

// The unique index (org, project, surface, cohortMatchVersion, window) is wider than
// bySurface, so the post-conflict fetch must match on the full identity or it can hand
// back a different window's row for the same (project, surface) pair.
function byIdentity(input: RecordDivergenceInput): SQL | undefined {
  return and(
    eq(divergencePoints.projectId, input.projectId),
    eq(divergencePoints.surface, input.surface),
    eq(divergencePoints.cohortMatchVersion, input.cohortMatchVersion),
    eq(divergencePoints.windowStart, input.windowStart),
    eq(divergencePoints.windowEnd, input.windowEnd),
  );
}

export function createDivergencePointsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): DivergencePointsRepo {
  const c = orgCrud(db, ctx, divergencePoints);

  return {
    async recordDivergence(input: RecordDivergenceInput): Promise<DivergencePointRecord> {
      return c.insertOrFetch(
        {
          projectId: input.projectId,
          surface: input.surface,
          surfaceNormalisationVersion: input.surfaceNormalisationVersion,
          spineVersion: input.spineVersion,
          cohortMatchVersion: input.cohortMatchVersion,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          kind: input.kind,
          divergedAtRank: input.divergedAtRank,
          reason: input.reason,
          succeededCohortSize: input.succeededCohortSize,
          failedCohortSize: input.failedCohortSize,
          succeededSessionIdsSample: input.succeededSessionIdsSample,
          failedSessionIdsSample: input.failedSessionIdsSample,
        },
        {
          target: DIVERGENCE_POINTS_CONFLICT_TARGET,
          set: {
            kind: sql`excluded.kind`,
            divergedAtRank: sql`excluded.diverged_at_rank`,
            reason: sql`excluded.reason`,
            succeededCohortSize: sql`excluded.succeeded_cohort_size`,
            failedCohortSize: sql`excluded.failed_cohort_size`,
            succeededSessionIdsSample: sql`excluded.succeeded_session_ids_sample`,
            failedSessionIdsSample: sql`excluded.failed_session_ids_sample`,
            updatedAt: sql`now()`,
          },
          fetch: [byIdentity(input)],
        },
      );
    },

    // Multiple rows can exist per (projectId, surface) across different windows over
    // time; the identity key is wider than this lookup, so this returns the most recent.
    async findBySurface(
      projectId: string,
      surface: string,
    ): Promise<DivergencePointRecord | null> {
      const rows = await c.list({
        where: bySurface(projectId, surface),
        orderBy: [desc(divergencePoints.createdAt)],
        limit: 1,
      });

      return rows[0] ?? null;
    },
  };
}
