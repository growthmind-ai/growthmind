import { summarySourceSchema, type SummarySource, type TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { findings } from "../schema/findings";
import { projects } from "../schema/projects";
import type { ScopedDb } from "./types";

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

export const findingContextSchema = z.array(z.string());

const countsSchema = z.array(measuredCountRowSchema);

type FindingRow = typeof findings.$inferSelect;

export type FindingRecord = Omit<FindingRow, "context" | "counts"> & {
  readonly context: readonly string[];
  readonly counts: readonly MeasuredCountRow[];
};

export interface PersistFindingInput {
  readonly projectId: string;
  readonly runId: string;

  readonly signature: string;

  readonly signatureVersion: number;
  readonly summarySource: SummarySource;
  readonly headline: string;
  readonly context: readonly string[];
  readonly finalClass: string;
  readonly surface: string;

  readonly surfaceNormalisationVersion: number | null;
  readonly counts: readonly MeasuredCountRow[];
  readonly confidenceBasis: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly evidenceShape: string;
  readonly evidenceShapeVersion: number;

  readonly resolvedModelId: string | null;

  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
}

export interface ListFindingsOptions {
  readonly limit: number;
}

export interface FindingsRepo {
  persist(input: PersistFindingInput): Promise<FindingRecord>;

  findBySignature(projectId: string, signature: string): Promise<FindingRecord | null>;

  listForProject(projectId: string, options: ListFindingsOptions): Promise<FindingRecord[]>;
}

export const FINDING_CONFLICT_TARGET = [
  findings.organizationId,
  findings.projectId,
  findings.signature,
];

function toRecord(row: FindingRow): FindingRecord {
  return {
    ...row,
    context: findingContextSchema.parse(row.context),
    counts: countsSchema.parse(row.counts),
  };
}

export function createFindingsRepo(db: ScopedDb, ctx: TenantContext): FindingsRepo {
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

          tokensIn: input.tokensIn ?? null,
          tokensOut: input.tokensOut ?? null,
        })
        .onConflictDoNothing({ target: FINDING_CONFLICT_TARGET })
        .returning();

      if (inserted) {
        return toRecord(inserted);
      }

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
