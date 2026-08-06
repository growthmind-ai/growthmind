import {
  DETECTOR_CORPUS_MAX_SESSIONS,
  readPersistedTranscript,
  type PersistedSessionAction,
} from "@growthmind/core";
import { summarySourceSchema, type SummarySource, type TenantContext } from "@growthmind/shared";
import type { ReplaySourceKind } from "@growthmind/shared";
import { and, desc, eq, inArray, isNotNull, lte, type SQL } from "drizzle-orm";
import { z } from "zod";

import { recordingSummaries, type TranscriptPullStop } from "../schema/recording-summaries";
import { sessions } from "../schema/sessions";
import { orgCrud } from "./crud";
import { readFindingText, type FindingText, type ScannedText } from "./finding-text";
import { scoped } from "./scope";
import type { ScopedExecutor } from "./types";

const pagesSchema = z.array(z.string());

type SummaryRow = typeof recordingSummaries.$inferSelect;

// The two fields a citation rests on are named and required; the rest of an action is whatever
// version stamped it, so the column's type stays open and `readPersistedTranscript` is the one
// place that decides whether a stored value is still readable (D5).
export type StoredTranscriptAction = {
  readonly kind: string;
  readonly atMs: number;
  readonly [field: string]: unknown;
};

export type StoredTranscript = {
  readonly v: number;
  readonly actions: readonly StoredTranscriptAction[];
};

export type RecordingSummaryRecord = Omit<
  SummaryRow,
  "headline" | "context" | "pages" | "actions"
> & {
  readonly text: FindingText;
  readonly pages: readonly string[];
  readonly actions: StoredTranscript | null;
};

export type SessionRecordingCitation = {
  readonly sessionId: string;
  readonly recordingId: string;
  readonly provider: ReplaySourceKind;
  readonly transcriptVersion: number | null;

  // Null when nothing readable is stored — a payload from a newer version, a corrupt one, or no
  // transcript at all. An empty array means the recording genuinely had no beats (D5).
  readonly actions: readonly PersistedSessionAction[] | null;
  readonly omitted: number;
  readonly pullStop: TranscriptPullStop | null;
  readonly pullReason: string | null;
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

  readonly provider?: ReplaySourceKind;
  readonly sessionKey?: string | null;
  readonly sessionGroupingVersion?: number | null;

  readonly actions?: StoredTranscript | null;
  readonly actionsVersion?: number | null;
  readonly actionsOmitted?: number | null;

  readonly pullStop?: TranscriptPullStop | null;
  readonly pullReason?: string | null;
  readonly pullWatermarkAt?: Date | null;
  readonly bytesReceived?: number | null;

  // The cursor a not-yet-exhausted pull reported, and the wall-clock instant its walk's
  // atMs offsets are measured from — both null once a pull is exhausted or has never run.
  readonly pullResumeCursor?: string | null;
  readonly pullOriginAt?: Date | null;

  readonly resolvedModelId: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
}

// A pull that stopped on a cap read every byte it was allowed to read, so re-pulling it returns
// the same bytes and the same cap. A pull that failed did not, and the row holding its partial
// transcript is the one thing a later tick may improve (D4).
export const RETRYABLE_PULL_STOP = "failed" satisfies TranscriptPullStop;

export interface RefreshFailedPullInput {
  readonly projectId: string;
  readonly recordingId: string;

  readonly transcript: string;
  readonly pages: readonly string[];
  readonly durationMs: number;
  readonly actionCount: number;
  readonly notableCount: number;
  readonly droppedEvents: number;

  readonly actions: StoredTranscript | null;
  readonly actionsVersion: number | null;
  readonly actionsOmitted: number | null;

  readonly pullStop: TranscriptPullStop | null;
  readonly pullReason: string | null;
  readonly pullWatermarkAt: Date | null;
  readonly bytesReceived: number | null;

  readonly pullResumeCursor: string | null;
  readonly pullOriginAt: Date | null;
}

export interface RecordingSummariesRepo {
  persist(input: PersistRecordingSummaryInput): Promise<RecordingSummaryRecord>;

  findFor(projectId: string, recordingId: string): Promise<RecordingSummaryRecord | null>;

  // The set of ids already summarised, so the poll never spends a model call twice on one
  // recording (D3). Asked before narration, not after.
  summarisedIds(projectId: string, recordingIds: readonly string[]): Promise<Set<string>>;

  // The subset of those whose pull failed rather than reaching a bound, so a rate limit is a
  // recording read again next tick rather than a transcript frozen at its partial form.
  retryablePullIds(projectId: string, recordingIds: readonly string[]): Promise<Set<string>>;

  // Replaces the evidence on a failed row and nothing else — the narration and its provenance
  // stay as written, so a retry costs a pull and never a second model call. Null when the row
  // settled first, or when the retry read less than the row already holds.
  refreshFailedPull(input: RefreshFailedPullInput): Promise<RecordingSummaryRecord | null>;

  latestStartedAt(projectId: string): Promise<Date | null>;

  citationsFor(
    projectId: string,
    sessionIds: readonly string[],
  ): Promise<readonly SessionRecordingCitation[]>;
}

export const RECORDING_SUMMARY_CONFLICT_TARGET = [
  recordingSummaries.organizationId,
  recordingSummaries.projectId,
  recordingSummaries.recordingId,
];

const notOurProject = (): Error =>
  new Error("recording summaries: the project named is not this organization's");

const tooManySessions = (asked: number): Error =>
  new Error(
    `recording summaries: asked for citations across ${String(asked)} sessions, and the corpus ` +
      `carries at most ${String(DETECTOR_CORPUS_MAX_SESSIONS)}. Truncating here would return a ` +
      `citation set that is short by half and looks identical to a complete one.`,
  );

function toRecord(row: SummaryRow): RecordingSummaryRecord {
  const { headline, context, pages, actions, ...rest } = row;

  return {
    ...rest,
    text: readFindingText({ headline, context }),
    pages: pagesSchema.parse(pages),
    actions: readPersistedTranscript(actions),
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

  async function heldIds(
    projectId: string,
    recordingIds: readonly string[],
    ...conditions: (SQL | undefined)[]
  ): Promise<Set<string>> {
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
          ...conditions,
        ),
      );

    return new Set(rows.map((row) => row.recordingId));
  }

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

          provider: input.provider ?? "posthog",
          sessionKey: input.sessionKey ?? null,
          sessionGroupingVersion: input.sessionGroupingVersion ?? null,

          actions: input.actions ?? null,
          actionsVersion: input.actionsVersion ?? null,
          actionsOmitted: input.actionsOmitted ?? null,

          pullStop: input.pullStop ?? null,
          pullReason: input.pullReason ?? null,
          pullWatermarkAt: input.pullWatermarkAt ?? null,
          bytesReceived: input.bytesReceived ?? null,

          pullResumeCursor: input.pullResumeCursor ?? null,
          pullOriginAt: input.pullOriginAt ?? null,

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
      return heldIds(projectId, recordingIds);
    },

    async retryablePullIds(
      projectId: string,
      recordingIds: readonly string[],
    ): Promise<Set<string>> {
      return heldIds(projectId, recordingIds, eq(recordingSummaries.pullStop, RETRYABLE_PULL_STOP));
    },

    async refreshFailedPull(input: RefreshFailedPullInput): Promise<RecordingSummaryRecord | null> {
      const pages = pagesSchema.parse(input.pages);

      // One statement, so two overlapping ticks cannot both read "failed" and both write. The
      // action-count predicate keeps the row monotonic: a retry throttled earlier than the first
      // attempt would otherwise replace a longer transcript with a shorter one.
      const row = await c.update(
        {
          transcript: input.transcript,
          pages,
          durationMs: input.durationMs,
          actionCount: input.actionCount,
          notableCount: input.notableCount,
          droppedEvents: input.droppedEvents,

          actions: input.actions,
          actionsVersion: input.actionsVersion,
          actionsOmitted: input.actionsOmitted,

          pullStop: input.pullStop,
          pullReason: input.pullReason,
          pullWatermarkAt: input.pullWatermarkAt,
          bytesReceived: input.bytesReceived,

          pullResumeCursor: input.pullResumeCursor,
          pullOriginAt: input.pullOriginAt,

          updatedAt: new Date(),
        },
        byRecording(input.projectId, input.recordingId),
        eq(recordingSummaries.pullStop, RETRYABLE_PULL_STOP),
        lte(recordingSummaries.actionCount, input.actionCount),
      );

      return row === null ? null : toRecord(row);
    },

    async latestStartedAt(projectId: string): Promise<Date | null> {
      // A row with no known start instant can never be the latest known start instant, and
      // without this predicate one of them pins the watermark to null forever: Postgres orders
      // DESC as NULLS FIRST, so the poll re-lists everything on every tick.
      const [row] = await db
        .select({ startedAt: recordingSummaries.startedAt })
        .from(recordingSummaries)
        .where(
          s.owned(
            recordingSummaries,
            eq(recordingSummaries.projectId, projectId),
            isNotNull(recordingSummaries.startedAt),
          ),
        )
        .orderBy(desc(recordingSummaries.startedAt))
        .limit(1);

      return row?.startedAt ?? null;
    },

    async citationsFor(
      projectId: string,
      sessionIds: readonly string[],
    ): Promise<readonly SessionRecordingCitation[]> {
      if (sessionIds.length === 0) {
        return [];
      }

      if (sessionIds.length > DETECTOR_CORPUS_MAX_SESSIONS) {
        throw tooManySessions(sessionIds.length);
      }

      // A join has no auto-injected tenant filter, so each side carries its own.
      const rows = await db
        .select({
          sessionId: sessions.id,
          recordingId: recordingSummaries.recordingId,
          provider: recordingSummaries.provider,
          actions: recordingSummaries.actions,
          actionsVersion: recordingSummaries.actionsVersion,
          actionsOmitted: recordingSummaries.actionsOmitted,
          pullStop: recordingSummaries.pullStop,
          pullReason: recordingSummaries.pullReason,
        })
        .from(sessions)
        .innerJoin(
          recordingSummaries,
          and(
            eq(recordingSummaries.projectId, sessions.projectId),
            eq(recordingSummaries.sessionKey, sessions.sessionKey),
          ),
        )
        .where(
          and(
            s.owned(
              sessions,
              eq(sessions.projectId, projectId),
              inArray(sessions.id, [...sessionIds]),
            ),
            s.org(recordingSummaries),
            isNotNull(recordingSummaries.sessionKey),
          ),
        );

      return rows.map((row) => ({
        sessionId: row.sessionId,
        recordingId: row.recordingId,
        provider: row.provider,
        transcriptVersion: row.actionsVersion,
        actions: readPersistedTranscript(row.actions)?.actions ?? null,
        omitted: row.actionsOmitted ?? 0,
        pullStop: row.pullStop,
        pullReason: row.pullReason,
      }));
    },
  };
}
