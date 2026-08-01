// Repository for the `findings` table (O-011 FR-M7 / FR-M9 / FR-M14 / FR-M19,
// ADD AD-1/AD-5/AD-8/AD-12/AD-18).
//
// ── THE O-011 DEFERRAL IS DISCHARGED: THIS TABLE HAS READERS (O-008 FR-O25) ──
// O-011 recorded, here and on `../schema/findings.ts`, that the `delivery-tick`
// wire was CUT because delivery was missing a lane source and a poster built
// from a `slack_connections` row this repository did not have. That table now
// exists (`../schema/slack-connections.ts`), so the deferral's stated reason has
// expired and the claim that nothing reads these rows would now be false.
//
// O-008 closes the wire and adds two readers, both of them through the methods
// below rather than around them: the first-run status read takes the single
// newest finding for one project, and the delivery lane source composes an
// organization's undelivered findings for its own channel. Neither is a new
// door — the org-scope rule in the next paragraph governs both, and there is
// still no method here that takes an organization id.
//
// ── ORG SCOPE COMES FROM THE CONTEXT, AND FROM NOWHERE ELSE (D2, D7) ─────────
// Same shape as `deliveries.repo.ts`: `createFindingsRepo(db, ctx)`. No method
// takes an organization id, so there is no id-only write path onto this table.
// The writer is a Graphile Worker task running with NO USER — the exact "path
// that steps outside the tenant context flow" — so the explicit
// `organization_id` predicate on every statement here IS the entire tenant
// boundary for this lane. No system/bypass context is reachable from this file.
//
// ── JSONB IS PARSED ON WRITE **AND** ON READ (D5, AD-18) ────────────────────
// `context` and `counts` are `unknown` at the schema level on purpose. A jsonb
// column holds every shape ever written, not the shape today's code writes, so
// both directions go through Zod. `summary_source` is parsed through the shared
// union BEFORE the write for the same reason: a value forged past the types at
// runtime (a stale enqueued payload, a hand-run script) is refused at the wire
// rather than persisted as a state no message table has a sentence for.
//
// ── NULL MEANS NOT REPORTED, NEVER ZERO (FR-M9, AD-5) ───────────────────────
// `tokensIn`/`tokensOut` arrive as `null`/`undefined` when the SDK metered
// nothing, and land as SQL NULL. Never coalesced to `0`: a candidate the model
// touched but did not meter must not look identical to one that cost nothing.
// `surfaceNormalisationVersion` is nullable for the same reason and not a
// weaker one: the candidate contract declares it `z.number().int().nullable()`
// and NOT `.positive()` (`core/src/findings/candidate.ts:93`), so `0` is a
// version a normaliser may legitimately report and cannot also stand for "none
// recorded" — least of all on a column that feeds D12 identity comparisons.
import { summarySourceSchema, type SummarySource, type TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { findings } from "../schema/findings";
import { projects } from "../schema/projects";
import type { ScopedDb } from "./types";

/**
 * The persisted form of a `MeasuredCount` (`@growthmind/core`).
 *
 * Structural, NOT the branded type. The brand is a module-private symbol that
 * only `measuredCount()` can stamp and that no round-trip through jsonb can
 * recreate — so a repository that claimed to return `MeasuredCount` would be
 * lying about every read. A consumer that needs the branded value re-runs the
 * constructor over this row; the boundary's job is to prove the SHAPE survived.
 *
 * `timeframe` is coerced rather than declared `z.date()`: JSON has no Date, so
 * these two fields leave as `Date` and come back as ISO strings. `z.coerce.date`
 * accepts both, which is what lets ONE schema guard both directions.
 */
export const measuredCountRowSchema = z.object({
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  unit: z.literal("sessions"),
  timeframe: z.object({ start: z.coerce.date(), end: z.coerce.date() }),
  basis: z.object({
    totalInWindow: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    setAside: z.array(
      z.object({
        reason: z.string(),
        count: z.number().int().nonnegative(),
        label: z.string(),
      }),
    ),
  }),
});
export type MeasuredCountRow = z.infer<typeof measuredCountRowSchema>;

/** One sentence per element (AD-8) — never a blob to be re-split downstream. */
export const findingContextSchema = z.array(z.string());

const countsSchema = z.array(measuredCountRowSchema);

type FindingRow = typeof findings.$inferSelect;

/** A finding as this repository hands it out: the row, with its two jsonb
 * columns replaced by their PARSED values. Nothing downstream re-parses, and
 * nothing downstream is handed an `unknown`. */
export type FindingRecord = Omit<FindingRow, "context" | "counts"> & {
  readonly context: readonly string[];
  readonly counts: readonly MeasuredCountRow[];
};

export interface PersistFindingInput {
  readonly projectId: string;
  readonly runId: string;
  /** THE FINDING'S IDENTITY (ADD v2 AD-20, D12), and the value the unique
   * index conflicts on. Derived by the caller through the ONE producer,
   * `computeFindingSignature` — this repository accepts it, never mints it, and
   * nothing here re-implements the hash. */
  readonly signature: string;
  /** Which tuple serialisation produced `signature`. Stored beside it so
   * provenance is read rather than guessed at. */
  readonly signatureVersion: number;
  readonly summarySource: SummarySource;
  readonly headline: string;
  readonly context: readonly string[];
  readonly finalClass: string;
  readonly surface: string;
  /** `null` = NO VERSION WAS RECORDED. Never `0`, which is a version a producer
   * may legitimately emit — see the header. */
  readonly surfaceNormalisationVersion: number | null;
  readonly counts: readonly MeasuredCountRow[];
  readonly confidenceBasis: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly evidenceShape: string;
  readonly evidenceShapeVersion: number;
  /** Null iff NO call was attempted for this candidate — including on the
   * defensive path where the port throws, which carries the model id the
   * composition root resolved rather than a null. */
  readonly resolvedModelId: string | null;
  /** `null`/`undefined` = NOT REPORTED. Never written as `0` (FR-M9). */
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
}

export interface ListFindingsOptions {
  readonly limit: number;
}

export interface FindingsRepo {
  /**
   * Idempotent BY CONSTRUCTION (D4). One `INSERT … ON CONFLICT
   * (organization_id, project_id, signature) DO NOTHING`, never a
   * check-then-write: a Graphile Worker replay of the analysis task — or a
   * later tick that re-derives the same identity — conflicts and reads the row
   * it already wrote, rather than minting a second finding that would be
   * delivered twice.
   *
   * Refuses — throws, before any statement runs — a `summary_source`, a
   * `context` or a `counts` value the shared shapes never declared (AD-18).
   */
  persist(input: PersistFindingInput): Promise<FindingRecord>;
  /** Org- AND project-scoped. `null` for a signature that does not exist,
   * belongs to another project, or belongs to another org. */
  findBySignature(projectId: string, signature: string): Promise<FindingRecord | null>;
  /** Org- AND project-scoped, newest first. */
  listForProject(projectId: string, options: ListFindingsOptions): Promise<FindingRecord[]>;
}

/** The unique tuple every persist conflicts on (D4). Org-first: a signature is
 * CONTENT-DERIVED (ADD v2 AD-20), and nothing about a customer's own funnel
 * shape makes it unique across customers — so two organizations with the same
 * problem on the same page path WILL produce the same string. */
export const FINDING_CONFLICT_TARGET = [
  findings.organizationId,
  findings.projectId,
  findings.signature,
];

/** Both jsonb columns, parsed on the way OUT. A row written by an older shape
 * is refused here rather than handed to a caller as an `unknown` it will cast. */
function toRecord(row: FindingRow): FindingRecord {
  return {
    ...row,
    context: findingContextSchema.parse(row.context),
    counts: countsSchema.parse(row.counts),
  };
}

export function createFindingsRepo(db: ScopedDb, ctx: TenantContext): FindingsRepo {
  /**
   * `project_id` is CLIENT-SUPPLIED on every write here, and the org column
   * alone does not constrain it (D7/FR-M14). Without this, a caller handing
   * another org's project id would mint a row stamped with ITS OWN org and the
   * FOREIGN project — not a cross-tenant read, but a finding attributed to a
   * product it did not come from, and one its owner can never see.
   *
   * This is a GUARD, not a claim, so it is not the D6 check-then-write hazard:
   * a project's owning organization is immutable, so there is no window in
   * which the answer changes between this read and the insert.
   */
  async function assertProjectIsOurs(projectId: string): Promise<void> {
    const [owned] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, ctx.organizationId), eq(projects.id, projectId)))
      .limit(1);

    if (!owned) {
      throw new Error("findings: the project named is not this organization's");
    }
  }

  return {
    async persist(input: PersistFindingInput): Promise<FindingRecord> {
      // Parsed BEFORE the write. A refusal here leaves the table untouched —
      // which is what "refused at the wire" means, as against "thrown after a
      // partial write landed".
      const summarySource = summarySourceSchema.parse(input.summarySource);
      const context = findingContextSchema.parse(input.context);
      const counts = countsSchema.parse(input.counts);
      await assertProjectIsOurs(input.projectId);

      const [inserted] = await db
        .insert(findings)
        .values({
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          runId: input.runId,
          signature: input.signature,
          signatureVersion: input.signatureVersion,
          summarySource,
          headline: input.headline,
          context,
          finalClass: input.finalClass,
          surface: input.surface,
          surfaceNormalisationVersion: input.surfaceNormalisationVersion,
          counts,
          confidenceBasis: input.confidenceBasis,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          evidenceShape: input.evidenceShape,
          evidenceShapeVersion: input.evidenceShapeVersion,
          resolvedModelId: input.resolvedModelId,
          // `?? null` — NOT `?? 0`. An unreported count lands as SQL NULL, so
          // "the model touched this and reported nothing" stays distinguishable
          // from "this cost nothing" forever (FR-M9).
          tokensIn: input.tokensIn ?? null,
          tokensOut: input.tokensOut ?? null,
        })
        .onConflictDoNothing({ target: FINDING_CONFLICT_TARGET })
        .returning();

      if (inserted) {
        return toRecord(inserted);
      }

      // The replay branch. Read back under OUR org — the conflicting row is
      // ours by construction (we inserted `ctx.organizationId`), so this can
      // never surface another tenant's finding.
      const [existing] = await db
        .select()
        .from(findings)
        .where(
          and(
            eq(findings.organizationId, ctx.organizationId),
            eq(findings.projectId, input.projectId),
            eq(findings.signature, input.signature),
          ),
        )
        .limit(1);

      if (!existing) {
        // The conflicting row vanished between the insert and this read (an
        // org/project cascade landing in the gap). Loud, because a caller that
        // treated this as success would report a finding that does not exist.
        throw new Error("findings: persist conflicted but no row was found to return");
      }

      return toRecord(existing);
    },

    async findBySignature(projectId: string, signature: string): Promise<FindingRecord | null> {
      const [row] = await db
        .select()
        .from(findings)
        .where(
          and(
            eq(findings.organizationId, ctx.organizationId),
            eq(findings.projectId, projectId),
            eq(findings.signature, signature),
          ),
        )
        .limit(1);

      return row ? toRecord(row) : null;
    },

    async listForProject(
      projectId: string,
      options: ListFindingsOptions,
    ): Promise<FindingRecord[]> {
      // `projectId` NARROWS — it is never a substitute for the org predicate,
      // and the org predicate is never a substitute for it. A dropped project
      // filter would attribute a finding to a product it did not come from.
      const rows = await db
        .select()
        .from(findings)
        .where(
          and(eq(findings.organizationId, ctx.organizationId), eq(findings.projectId, projectId)),
        )
        .orderBy(desc(findings.createdAt))
        .limit(options.limit);

      return rows.map(toRecord);
    },
  };
}
