import { summarySourceSchema, type SummarySource, type TenantContext } from "@growthmind/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { recordingSummaries } from "../schema/recording-summaries";
import { orgCrud } from "./crud";
import { readFindingText, type FindingText, type ScannedText } from "./finding-text";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

const pagesSchema = z.array(z.string());

type SummaryRow = typeof recordingSummaries.$inferSelect;

export type RecordingSummaryRecord = Omit<SummaryRow, "headline" | "context" | "pages"> & {
  readonly text: FindingText;
  readonly pages: readonly string[];
};

export interface PersistRecordingSummaryInput {
  readonly projectId: string;
  readonly recordingId: string;

  readonly summarySource: SummarySource;
  readonly headline: ScannedText;
  readonly context: readonly ScannedText[];

  readonly transcript: string;
  readonly pages: readonly string[];
  readonly durationMs: number;
  readonly actionCount: number;
  readonly notableCount: number;
  readonly droppedEvents: number;

  readonly startedAt: Date | null;

  readonly resolvedModelId: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
}

export interface RecordingSummariesRepo {
  persist(input: PersistRecordingSummaryInput): Promise<RecordingSummaryRecord>;

  findFor(projectId: string, recordingId: string): Promise<RecordingSummaryRecord | null>;

  // The set of ids already summarised, so the poll never spends a model call twice on one
  // recording (D3). Asked before narration, not after.
  summarisedIds(projectId: string, recordingIds: readonly string[]): Promise<Set<string>>;

  latestStartedAt(projectId: string): Promise<Date | null>;
}

export const RECORDING_SUMMARY_CONFLICT_TARGET = [
  recordingSummaries.organizationId,
  recordingSummaries.projectId,
  recordingSummaries.recordingId,
];

const notOurProject = (): Error =>
  new Error("recording summaries: the project named is not this organization's");

function toRecord(row: SummaryRow): RecordingSummaryRecord {
  const { headline, context, pages, ...rest } = row;

  return {
    ...rest,
    text: readFindingText({ headline, context }),
    pages: pagesSchema.parse(pages),
  };
}

function byRecording(projectId: string, recordingId: string) {
  return and(
    eq(recordingSummaries.projectId, projectId),
    eq(recordingSummaries.recordingId, recordingId),
  );
}

export function createRecordingSummariesRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): RecordingSummariesRepo {
  const s = scoped(db, ctx);
  const c = orgCrud(db, ctx, recordingSummaries);

  return {
    async persist(input: PersistRecordingSummaryInput): Promise<RecordingSummaryRecord> {
      const summarySource = summarySourceSchema.parse(input.summarySource);
      const pages = pagesSchema.parse(input.pages);
      await s.assertProjectOwned(input.projectId, notOurProject);

      const row = await c.insertOrFetch(
        {
          projectId: input.projectId,
          recordingId: input.recordingId,
          summarySource,
          headline: input.headline,
          context: input.context,
          transcript: input.transcript,
          pages,
          durationMs: input.durationMs,
          actionCount: input.actionCount,
          notableCount: input.notableCount,
          droppedEvents: input.droppedEvents,
          startedAt: input.startedAt,
          resolvedModelId: input.resolvedModelId,

          tokensIn: input.tokensIn ?? null,
          tokensOut: input.tokensOut ?? null,
        },
        {
          target: RECORDING_SUMMARY_CONFLICT_TARGET,
          fetch: [byRecording(input.projectId, input.recordingId)],
        },
      );

      return toRecord(row);
    },

    async findFor(projectId: string, recordingId: string): Promise<RecordingSummaryRecord | null> {
      const row = await c.maybe(byRecording(projectId, recordingId));
      return row === null ? null : toRecord(row);
    },

    async summarisedIds(projectId: string, recordingIds: readonly string[]): Promise<Set<string>> {
      if (recordingIds.length === 0) {
        return new Set<string>();
      }

      const rows = await db
        .select({ recordingId: recordingSummaries.recordingId })
        .from(recordingSummaries)
        .where(
          s.owned(
            recordingSummaries,
            eq(recordingSummaries.projectId, projectId),
            inArray(recordingSummaries.recordingId, [...recordingIds]),
          ),
        );

      return new Set(rows.map((row) => row.recordingId));
    },

    async latestStartedAt(projectId: string): Promise<Date | null> {
      const [row] = await db
        .select({ startedAt: recordingSummaries.startedAt })
        .from(recordingSummaries)
        .where(s.owned(recordingSummaries, eq(recordingSummaries.projectId, projectId)))
        .orderBy(desc(recordingSummaries.startedAt))
        .limit(1);

      return row?.startedAt ?? null;
    },
  };
}
