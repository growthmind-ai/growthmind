import { summarySourceSchema, type SummarySource, type TenantContext } from "@growthmind/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { findings } from "../schema/findings";
import { orgCrud } from "./crud";
import { readFindingText, type FindingText, type ScannedText } from "./finding-text";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

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

const countsSchema = z.array(measuredCountRowSchema);

type FindingRow = typeof findings.$inferSelect;

export type FindingRecord = Omit<FindingRow, "headline" | "context" | "counts"> & {
  readonly text: FindingText;
  readonly counts: readonly MeasuredCountRow[];
};

export interface PersistFindingInput {
  readonly projectId: string;
  readonly runId: string;

  readonly signature: string;

  readonly signatureVersion: number;
  readonly summarySource: SummarySource;
  readonly headline: ScannedText;
  readonly context: readonly ScannedText[];
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

const notOurProject = (): Error =>
  new Error("findings: the project named is not this organization's");

function toRecord(row: FindingRow): FindingRecord {
  const { headline, context, counts, ...rest } = row;

  return {
    ...rest,
    text: readFindingText({ headline, context }),
    counts: countsSchema.parse(counts),
  };
}

function bySignature(projectId: string, signature: string) {
  return and(eq(findings.projectId, projectId), eq(findings.signature, signature));
}

export function createFindingsRepo(db: ScopedExecutor, ctx: TenantContext): FindingsRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, findings);

  return {
    async persist(input: PersistFindingInput): Promise<FindingRecord> {
      const summarySource = summarySourceSchema.parse(input.summarySource);
      const counts = countsSchema.parse(input.counts);
      await s.assertProjectOwned(input.projectId, notOurProject);

      const row = await c.insertOrFetch(
        {
          projectId: input.projectId,
          runId: input.runId,
          signature: input.signature,
          signatureVersion: input.signatureVersion,
          summarySource,
          headline: input.headline,
          context: input.context,
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
        },
        {
          target: FINDING_CONFLICT_TARGET,
          fetch: [bySignature(input.projectId, input.signature)],
        },
      );

      return toRecord(row);
    },

    async findBySignature(projectId: string, signature: string): Promise<FindingRecord | null> {
      const row = await c.maybe(bySignature(projectId, signature));

      return row ? toRecord(row) : null;
    },

    async listForProject(
      projectId: string,
      options: ListFindingsOptions,
    ): Promise<FindingRecord[]> {
      const rows = await c.list({
        where: eq(findings.projectId, projectId),
        orderBy: [desc(findings.createdAt)],
        limit: options.limit,
      });

      return rows.map(toRecord);
    },
  };
}
