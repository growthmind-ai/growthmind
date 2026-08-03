import {
  IMPACT_ROLE,
  rehydrateFixSpecInput,
  renderFixSpec,
  resolveCounts,
  toFindingEvidence,
  type CandidateFinding,
  type FixSpecInput,
  type MeasuredCount,
} from "@growthmind/core";
import {
  FIX_RESULTS_RULE_VERSION,
  FIX_RESULTS_WINDOW_DAYS,
  logger,
  type FindingEvidence,
  type TenantContext,
} from "@growthmind/shared";
import { and, asc, eq, sql } from "drizzle-orm";

import { orgCrud } from "../repositories/crud";
import {
  createFindingPayloadsRepo,
  type FindingPayloadRow,
} from "../repositories/finding-payloads.repo";
import { findingContextSchema } from "../repositories/findings.repo";
import { createFixesRepo, openFixesIn, type FixRow } from "../repositories/fixes.repo";
import { scoped } from "../repositories/scope";
import type { ScopedDb } from "../repositories/types";
import { findingPayloads } from "../schema/finding-payloads";
import { findings } from "../schema/findings";
import { fixes } from "../schema/fixes";

export type OpenFixResult =
  | { readonly outcome: "opened"; readonly fix: FixRow }
  | { readonly outcome: "already_open"; readonly fix: FixRow }
  | { readonly outcome: "finding_not_found" }
  | { readonly outcome: "no_payload" }
  | { readonly outcome: "unrenderable" };

export interface OpenFixReadModel {
  readonly fixId: string;
  readonly findingId: string;

  readonly summary: string;
  readonly impact: MeasuredCount;
  readonly openedAt: Date;
  readonly resultsBy: Date;
}

export interface FixReadModel {
  readonly fix: FixRow;
  readonly spec: FixSpecInput;
  readonly impact: MeasuredCount;
}

export interface FindingReadModel {
  readonly findingId: string;
  readonly fixId: string | null;
  readonly headline: string;
  readonly detail: string;
  readonly surface: string;
  readonly affected: MeasuredCount;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly evidence: readonly FindingEvidence[];
}

export interface ListOpenFixesInput {
  readonly projectId: string | null;
  readonly limit: number;
}

export interface ListOpenFixesPage {
  readonly rows: OpenFixReadModel[];
  readonly totalOpen: number;
}

export interface FixesService {
  openFor(findingId: string): Promise<OpenFixResult>;

  readFix(fixId: string): Promise<FixReadModel | null>;

  readFinding(findingId: string): Promise<FindingReadModel | null>;

  listOpen(input: ListOpenFixesInput): Promise<ListOpenFixesPage>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const RESULTS_WINDOW_MS = FIX_RESULTS_WINDOW_DAYS * MS_PER_DAY;

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function specOf(row: FindingPayloadRow): FixSpecInput | null {
  try {
    return rehydrateFixSpecInput({
      payloadVersion: row.payloadVersion,
      candidate: row.candidate,
      signals: row.signals,
    });
  } catch (error) {
    logger.error("fixes: a stored fix-spec payload could not be read back", {
      findingId: row.findingId,
      reason: reasonOf(error),
    });
    return null;
  }
}

// The renderability check belongs at the mint: a fix that exists but throws inside
// `get_fix` is a broken promise to a coding agent, and it reads as a generic failure.
function renders(spec: FixSpecInput): boolean {
  try {
    renderFixSpec(spec);
    return true;
  } catch (error) {
    logger.error("fixes: a stored fix-spec payload cannot be rendered", {
      surface: spec.candidate.surface,
      reason: reasonOf(error),
    });
    return false;
  }
}

function impactOf(candidate: CandidateFinding): MeasuredCount | null {
  try {
    const resolved = resolveCounts(candidate);
    const countsByRole: Readonly<Record<string, MeasuredCount>> = resolved.counts;

    return countsByRole[IMPACT_ROLE[resolved.detector]] ?? null;
  } catch (error) {
    logger.error("fixes: a stored candidate resolved no count for its impact role", {
      detector: candidate.detector,
      reason: reasonOf(error),
    });
    return null;
  }
}

export function createFixesService(db: ScopedDb, ctx: TenantContext): FixesService {
  const s = scoped(db, ctx);
  const findingRows = orgCrud(db, ctx, findings);
  const payloads = createFindingPayloadsRepo(db, ctx);
  const repo = createFixesRepo(db, ctx);

  return {
    async openFor(findingId: string): Promise<OpenFixResult> {
      const finding = await findingRows.maybe(eq(findings.id, findingId));
      if (!finding) {
        return { outcome: "finding_not_found" };
      }

      const payload = await payloads.findForFinding(findingId);
      if (!payload) {
        return { outcome: "no_payload" };
      }

      const spec = specOf(payload);
      if (!spec || !renders(spec)) {
        return { outcome: "unrenderable" };
      }

      const openedAt = new Date();
      const claimed = await repo.claimFor({
        projectId: finding.projectId,
        findingId,
        openedAt,
        openedBy: ctx.userId,
        resultsBy: new Date(openedAt.getTime() + RESULTS_WINDOW_MS),
        resultsByRuleVersion: FIX_RESULTS_RULE_VERSION,
      });

      const fix = claimed.row ?? (await repo.findForFinding(findingId));
      if (!fix) {
        return { outcome: "finding_not_found" };
      }

      return claimed.claimed ? { outcome: "opened", fix } : { outcome: "already_open", fix };
    },

    async readFix(fixId: string): Promise<FixReadModel | null> {
      const fix = await repo.findById(fixId);
      if (!fix) {
        return null;
      }

      const payload = await payloads.findForFinding(fix.findingId);
      if (!payload) {
        return null;
      }

      const spec = specOf(payload);
      if (!spec || !renders(spec)) {
        return null;
      }

      const impact = impactOf(spec.candidate);

      return impact ? { fix, spec, impact } : null;
    },

    async readFinding(findingId: string): Promise<FindingReadModel | null> {
      const finding = await findingRows.maybe(eq(findings.id, findingId));
      if (!finding) {
        return null;
      }

      const payload = await payloads.findForFinding(findingId);
      if (!payload) {
        return null;
      }

      const spec = specOf(payload);
      if (!spec) {
        return null;
      }

      // Derived from what a detector observed. `findings.context` is rendered prose, and
      // reading an observation out of a sentence would be inventing one.
      const evidence = toFindingEvidence(spec.signals);
      const affected = impactOf(spec.candidate);
      if (evidence.length === 0 || !affected) {
        return null;
      }

      const fix = await repo.findForFinding(findingId);
      const detail = findingContextSchema.parse(finding.context).join(" ").trim();

      return {
        findingId: finding.id,
        fixId: fix?.id ?? null,
        headline: finding.headline,
        detail: detail === "" ? finding.headline : detail,
        surface: finding.surface,
        affected,
        firstSeenAt: finding.windowStart,
        lastSeenAt: finding.windowEnd,
        evidence,
      };
    },

    async listOpen(input: ListOpenFixesInput): Promise<ListOpenFixesPage> {
      const where = s.owned(fixes, openFixesIn(input.projectId));

      // Both joined tables carry their own org predicate: the join key alone does not
      // scope the right-hand side.
      const payloadJoin = and(
        eq(findingPayloads.findingId, fixes.findingId),
        s.org(findingPayloads),
      );

      const joined = await db
        .select({ fix: fixes, payload: findingPayloads, headline: findings.headline })
        .from(fixes)
        .innerJoin(findingPayloads, payloadJoin)
        .innerJoin(findings, and(eq(findings.id, fixes.findingId), s.org(findings)))
        .where(where)
        .orderBy(asc(fixes.resultsBy), asc(fixes.openedAt))
        .limit(input.limit);

      const [counted] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(fixes)
        .innerJoin(findingPayloads, payloadJoin)
        .where(where);

      const rows: OpenFixReadModel[] = [];
      for (const row of joined) {
        const spec = specOf(row.payload);
        const impact = spec ? impactOf(spec.candidate) : null;
        if (!impact) {
          continue;
        }

        rows.push({
          fixId: row.fix.id,
          findingId: row.fix.findingId,
          summary: row.headline,
          impact,
          openedAt: row.fix.openedAt,
          resultsBy: row.fix.resultsBy,
        });
      }

      return { rows, totalOpen: Number(counted?.count ?? 0) };
    },
  };
}
