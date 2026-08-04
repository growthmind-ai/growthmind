import {
  isProposableSurface,
  proposalScopeOf,
  rehydrateFixSpecInput,
  resolveCounts,
  IMPACT_ROLE,
  type MeasuredCount,
} from "@growthmind/core";
import {
  logger,
  type ForbiddenReason,
  type SurfaceRole,
  type TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

import { createGrowthContextRepo } from "../repositories/growth-context.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { dismissals } from "../schema/dismissals";
import { findingPayloads } from "../schema/finding-payloads";
import { findings } from "../schema/findings";
import { fixes } from "../schema/fixes";

export const GROWTH_CONTEXT_ITEM_LIMIT = 10;

export interface RoledSurfaceNote {
  readonly surface: string;
  readonly role: SurfaceRole;
  readonly confirmedByAPerson: boolean;
}

export interface KnownProblemRow {
  readonly findingId: string;
  readonly fixId: string | null;
  readonly headline: string;
  readonly affected: MeasuredCount;
  readonly lastSeenAt: Date;
}

export interface DeclinedIdeaRow {
  readonly headline: string;
  readonly declinedAt: Date;
}

export interface GrowthContextReadModel {
  readonly projectId: string;
  readonly surface: string | null;
  readonly changeable: {
    readonly allowed: boolean;
    readonly reason: ForbiddenReason | null;
  } | null;
  readonly whatMatters: readonly RoledSurfaceNote[];
  readonly knownProblems: readonly KnownProblemRow[];
  readonly declined: readonly DeclinedIdeaRow[];
}

export interface ReadGrowthContextInput {
  readonly projectId: string;
  readonly surface: string | null;
}

export interface GrowthContextService {
  read(input: ReadGrowthContextInput): Promise<GrowthContextReadModel>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createGrowthContextService(db: ScopedDb, ctx: TenantContext): GrowthContextService {
  const s = scoped(db, ctx);
  const growth = createGrowthContextRepo(db, ctx);

  // The impact count lives in the stored payload, not on the finding row, so a finding whose
  // payload predates this build contributes no count and is left out rather than guessed at.
  async function affectedFor(findingIds: readonly string[]): Promise<Map<string, MeasuredCount>> {
    const byFinding = new Map<string, MeasuredCount>();
    if (findingIds.length === 0) {
      return byFinding;
    }

    const rows = await db
      .select()
      .from(findingPayloads)
      .where(s.owned(findingPayloads, inArray(findingPayloads.findingId, findingIds)));

    for (const row of rows) {
      try {
        const spec = rehydrateFixSpecInput({
          payloadVersion: row.payloadVersion,
          candidate: row.candidate,
          signals: row.signals,
        });
        const resolved = resolveCounts(spec.candidate);
        const countsByRole: Readonly<Record<string, MeasuredCount>> = resolved.counts;
        const count = countsByRole[IMPACT_ROLE[resolved.detector]];
        if (count !== undefined) byFinding.set(row.findingId, count);
      } catch (error) {
        logger.error("growth context: a finding's stored impact could not be read back", {
          findingId: row.findingId,
          reason: reasonOf(error),
        });
      }
    }

    return byFinding;
  }

  return {
    async read(input: ReadGrowthContextInput): Promise<GrowthContextReadModel> {
      const context = await growth.findForProject(input.projectId);

      const changeable =
        input.surface === null
          ? null
          : verdictOf(isProposableSurface(input.surface, proposalScopeOf(context)));

      const roled = [...(context?.bySurface.values() ?? [])]
        .filter((entry) => (input.surface === null ? true : entry.surface === input.surface))
        .slice(0, GROWTH_CONTEXT_ITEM_LIMIT)
        .map((entry) => ({
          surface: entry.surface,
          role: entry.role,
          confirmedByAPerson: entry.confirmedAt !== null,
        }));

      const surfaceFilter =
        input.surface === null ? undefined : eq(findings.surface, input.surface);

      const recent = await db
        .select({
          id: findings.id,
          headline: findings.headline,
          windowEnd: findings.windowEnd,
          signature: findings.signature,
        })
        .from(findings)
        .where(s.owned(findings, eq(findings.projectId, input.projectId), surfaceFilter))
        .orderBy(desc(findings.createdAt))
        .limit(GROWTH_CONTEXT_ITEM_LIMIT);

      const findingIds = recent.map((row) => row.id);
      const affected = await affectedFor(findingIds);

      const openFixes =
        findingIds.length === 0
          ? []
          : await db
              .select({ id: fixes.id, findingId: fixes.findingId })
              .from(fixes)
              .where(s.owned(fixes, inArray(fixes.findingId, findingIds)));

      const fixByFinding = new Map(openFixes.map((row) => [row.findingId, row.id]));

      const knownProblems: KnownProblemRow[] = [];
      for (const row of recent) {
        const count = affected.get(row.id);
        if (count === undefined) continue;

        knownProblems.push({
          findingId: row.id,
          fixId: fixByFinding.get(row.id) ?? null,
          headline: row.headline,
          affected: count,
          lastSeenAt: row.windowEnd,
        });
      }

      // §8: never re-propose a dead idea. A dismissal is joined back to its finding for the
      // headline, because the dismissal row itself records only the signature it suppressed.
      const declinedRows = await db
        .select({ headline: findings.headline, dismissedAt: dismissals.dismissedAt })
        .from(dismissals)
        .innerJoin(findings, and(eq(findings.id, dismissals.findingId), s.org(findings)))
        .where(s.owned(dismissals, eq(dismissals.projectId, input.projectId), surfaceFilter))
        .orderBy(desc(dismissals.dismissedAt))
        .limit(GROWTH_CONTEXT_ITEM_LIMIT);

      return {
        projectId: input.projectId,
        surface: input.surface,
        changeable,
        whatMatters: roled,
        knownProblems,
        declined: declinedRows.map((row) => ({
          headline: row.headline,
          declinedAt: row.dismissedAt,
        })),
      };
    },
  };
}

function verdictOf(verdict: ReturnType<typeof isProposableSurface>): {
  readonly allowed: boolean;
  readonly reason: ForbiddenReason | null;
} {
  return verdict.proposable
    ? { allowed: true, reason: null }
    : { allowed: false, reason: verdict.reason };
}
