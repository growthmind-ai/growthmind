import {
  IMPACT_ROLE,
  compareExpectedValue,
  expectedValueOfCount,
  isProposableSurface,
  proposalScopeOf,
  rehydrateFixSpecInput,
  renderFixSpec,
  resolveCounts,
  toFindingEvidence,
  worthOf,
  type CandidateFinding,
  type ExpectedValue,
  type FixSpecInput,
  type MeasuredCount,
} from "@growthmind/core";
import {
  FIX_RESULTS_RULE_VERSION,
  FIX_RESULTS_WINDOW_DAYS,
  logger,
  type FindingEvidence,
  type ForbiddenReason,
  type TenantContext,
} from "@growthmind/shared";
import { and, asc, eq } from "drizzle-orm";

import { orgCrud } from "../repositories/crud";
import {
  createFindingPayloadsRepo,
  type FindingPayloadRow,
} from "../repositories/finding-payloads.repo";
import {
  describeHold,
  joinScanned,
  readFindingText,
  trimScanned,
  type HeldFindingText,
  type ScannedText,
} from "../repositories/finding-text";
import { createFixesRepo, openFixesIn, type FixRow } from "../repositories/fixes.repo";
import { createGrowthContextRepo } from "../repositories/growth-context.repo";
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
  | { readonly outcome: "unrenderable" }
  | {
      readonly outcome: "surface_forbidden";
      readonly reason: ForbiddenReason;
      readonly surface: string;
    };

export interface OpenFixReadModel {
  readonly fixId: string;
  readonly findingId: string;

  readonly summary: ScannedText;
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
  readonly headline: ScannedText;
  readonly detail: ScannedText;
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

// `warn`, not `error`: every finding written before the scan existed is unscanned, so one
// read over legacy rows would emit an error line per row and drown the ones that matter.
function heldOut(findingId: string, text: HeldFindingText): void {
  logger.warn("fixes: a finding's text is held, so it is not read back", {
    findingId,
    ...describeHold(text),
  });
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
  const growth = createGrowthContextRepo(db, ctx);

  return {
    async openFor(findingId: string): Promise<OpenFixResult> {
      const finding = await findingRows.maybe(eq(findings.id, findingId));
      if (!finding) {
        return { outcome: "finding_not_found" };
      }

      // Product decisions §5, before any work is minted. The finding itself still exists
      // and still delivers — what is refused is pointing a coding agent at pricing,
      // billing, auth, consent or terms, which is the one class of change that is never
      // ours to propose.
      const verdict = isProposableSurface(
        finding.surface,
        proposalScopeOf(await growth.findForProject(finding.projectId)),
      );
      if (!verdict.proposable) {
        return { outcome: "surface_forbidden", reason: verdict.reason, surface: finding.surface };
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

      // Before any other refusal, so a held row costs exactly one log line and answers
      // `null` — the same answer `get_finding` already gives for a row it cannot assemble.
      const text = readFindingText(finding);
      if (text.held) {
        heldOut(finding.id, text);
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

      // Trimmed through the brand, and the same value is both tested and returned: reading
      // an emptiness verdict off a trim the caller never receives is how `get_finding`
      // came to answer text with leading and trailing whitespace.
      const detail = trimScanned(joinScanned(text.context, " "));

      return {
        findingId: finding.id,
        fixId: fix?.id ?? null,
        headline: text.headline,
        detail: detail === "" ? text.headline : detail,
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

      // One pass answers both numbers. Whether a stored payload can be read back is decided
      // here and not in SQL, so a separate `count(*)` counts rows the page has already
      // dropped: bump the payload version and every fix written under the old one leaves
      // `rows` while the total still claims them, describing a slice that can never fill.
      const joined = await db
        .select({
          fix: fixes,
          payload: findingPayloads,

          // One verdict per row is taken over both columns, so both are selected: a gate
          // that scanned the headline alone would list a fix `get_finding` then refuses.
          headline: findings.headline,
          context: findings.context,
        })
        .from(fixes)
        .innerJoin(findingPayloads, payloadJoin)
        .innerJoin(findings, and(eq(findings.id, fixes.findingId), s.org(findings)))
        .where(where)
        .orderBy(asc(fixes.resultsBy), asc(fixes.openedAt));

      // The SQL order is the tiebreak, not the ranking. `list_open_fixes` tells an agent
      // it returns the most urgent first, and a deadline is not urgency — §6 ranks by
      // expected value, so the weighting is applied here where the impact count is
      // already resolved.
      const contexts = await growth.findForProjects(joined.map((row) => row.fix.projectId));

      const ranked: { readonly row: OpenFixReadModel; readonly value: ExpectedValue }[] = [];
      for (const row of joined) {
        // The row leaves `rows` AND the total below it, which counts what survived this
        // loop: a denominator the page can never fill is the defect this one pass exists
        // to avoid, and a hold must not reintroduce it.
        const text = readFindingText(row);
        if (text.held) {
          heldOut(row.fix.findingId, text);
          continue;
        }

        const spec = specOf(row.payload);
        const impact = spec ? impactOf(spec.candidate) : null;
        if (!impact || !spec) {
          continue;
        }

        ranked.push({
          row: {
            fixId: row.fix.id,
            findingId: row.fix.findingId,
            summary: text.headline,
            impact,
            openedAt: row.fix.openedAt,
            resultsBy: row.fix.resultsBy,
          },
          value: expectedValueOfCount(
            impact,
            worthOf(contexts.get(row.fix.projectId) ?? null, spec.candidate.surface),
          ),
        });
      }

      const readable = ranked
        .toSorted((a, b) => compareExpectedValue(a.value, b.value))
        .map((entry) => entry.row);

      return { rows: readable.slice(0, input.limit), totalOpen: readable.length };
    },
  };
}
