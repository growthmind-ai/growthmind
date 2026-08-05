import {
  isProposableSurface,
  proposalScopeOf,
  rehydrateFixSpecInput,
  resolveCounts,
  IMPACT_ROLE,
  type MeasuredCount,
} from "@growthmind/core";
import {
  isObservedProvenance,
  isStatedByAPerson,
  logger,
  type BusinessFactKind,
  type FactSeen,
  type ForbiddenReason,
  type SurfaceRole,
  type TenantContext,
} from "@growthmind/shared";
import { and, desc, eq, inArray } from "drizzle-orm";

import {
  describeHold,
  readFindingText,
  type HeldFindingText,
  type ScannedText,
} from "../repositories/finding-text";
import { createGrowthContextRepo } from "../repositories/growth-context.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { dismissals } from "../schema/dismissals";
import { findingPayloads } from "../schema/finding-payloads";
import { findings } from "../schema/findings";
import { fixes } from "../schema/fixes";

export const GROWTH_CONTEXT_ITEM_LIMIT = 10;

// Held rows are dropped after SQL returns, so the cap cannot be the SQL limit: a held row
// inside the window would take a slot from a clean row just past it. Bounded, because an
// unscanned table can hold more of them than any multiple would cover.
const GROWTH_CONTEXT_SCAN_LIMIT = GROWTH_CONTEXT_ITEM_LIMIT * 10;

export interface RoledSurfaceNote {
  readonly surface: string;
  readonly role: SurfaceRole;
  readonly confirmedByAPerson: boolean;
}

export interface KnownProblemRow {
  readonly findingId: string;
  readonly fixId: string | null;
  readonly headline: ScannedText;
  readonly affected: MeasuredCount;
  readonly lastSeenAt: Date;
}

export interface DeclinedIdeaRow {
  readonly headline: ScannedText;
  readonly declinedAt: Date;
}

export interface BusinessFactRow {
  readonly kind: BusinessFactKind;
  readonly statement: string;
  readonly statedByAPerson: boolean;
  readonly readFrom: string | null;
  readonly observed: boolean;
  readonly seen: FactSeen | null;
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
  readonly business: readonly BusinessFactRow[];
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

// `warn`, not `error`: every finding written before the scan existed is unscanned, so one
// read over legacy rows would emit an error line per row and drown the ones that matter.
function heldOut(findingId: string, text: HeldFindingText): void {
  logger.warn("growth context: a finding's text is held, so it is left out of the answer", {
    findingId,
    ...describeHold(text),
  });
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
      const site = await growth.readBusinessResearch(input.projectId);

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
          context: findings.context,
          windowEnd: findings.windowEnd,
          signature: findings.signature,
        })
        .from(findings)
        .where(s.owned(findings, eq(findings.projectId, input.projectId), surfaceFilter))
        .orderBy(desc(findings.createdAt))
        .limit(GROWTH_CONTEXT_SCAN_LIMIT);

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
        // The cap is applied to what survived, never in SQL: nothing here is counted, so a
        // held row needs no total corrected — but it must not spend a slot either.
        if (knownProblems.length === GROWTH_CONTEXT_ITEM_LIMIT) break;

        const text = readFindingText(row);
        if (text.held) {
          heldOut(row.id, text);
          continue;
        }

        const count = affected.get(row.id);
        if (count === undefined) continue;

        knownProblems.push({
          findingId: row.id,
          fixId: fixByFinding.get(row.id) ?? null,
          headline: text.headline,
          affected: count,
          lastSeenAt: row.windowEnd,
        });
      }

      // §8: never re-propose a dead idea. A dismissal is joined back to its finding for the
      // headline, because the dismissal row itself records only the signature it suppressed.
      const declinedRows = await db
        .select({
          findingId: dismissals.findingId,
          headline: findings.headline,
          context: findings.context,
          dismissedAt: dismissals.dismissedAt,
        })
        .from(dismissals)
        .innerJoin(findings, and(eq(findings.id, dismissals.findingId), s.org(findings)))
        .where(s.owned(dismissals, eq(dismissals.projectId, input.projectId), surfaceFilter))
        .orderBy(desc(dismissals.dismissedAt))
        .limit(GROWTH_CONTEXT_SCAN_LIMIT);

      const declined: DeclinedIdeaRow[] = [];
      for (const row of declinedRows) {
        if (declined.length === GROWTH_CONTEXT_ITEM_LIMIT) break;

        const text = readFindingText(row);
        if (text.held) {
          heldOut(row.findingId, text);
          continue;
        }

        declined.push({ headline: text.headline, declinedAt: row.dismissedAt });
      }

      return {
        projectId: input.projectId,
        surface: input.surface,
        changeable,
        whatMatters: roled,
        knownProblems,
        declined,
        // Not narrowed by surface, and not capped at the same ten as the rest: a licence or
        // a forbidden move is true of the business whatever page an agent is asking about,
        // and a constraint that fell off the end of a list is a constraint nothing enforces.
        business: (site?.businessContext.facts ?? []).map((fact) => ({
          kind: fact.kind,
          statement: fact.statement,
          statedByAPerson: isStatedByAPerson(fact.provenance),
          readFrom: fact.provenance.citation,
          observed: isObservedProvenance(fact.provenance),
          seen: fact.provenance.seen,
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
