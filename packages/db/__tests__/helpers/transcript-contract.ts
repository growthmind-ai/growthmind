// Wave 0 mirror of O-040's transcript persistence contract (ADD §3.1, §4.1, §6.1). The repo
// factory is cast to these types, so Wave 4 signature drift fails at runtime, not here.
import * as shared from "@growthmind/shared";
import type { ReplaySourceKind, TenantContext } from "@growthmind/shared";

import { createRecordingSummariesRepo } from "../../src/repositories/recording-summaries.repo";
import type {
  PersistRecordingSummaryInput,
  RecordingSummaryRecord,
} from "../../src/repositories/recording-summaries.repo";
import type { ScopedExecutor } from "../../src/repositories/types";

export type TranscriptPullStop = "exhausted" | "page_cap" | "byte_cap" | "failed";

export type PersistedSessionAction = {
  readonly kind: string;
  readonly atMs: number;
  readonly element?: Record<string, unknown>;
  readonly href?: string;
  readonly clicks?: number;
  readonly spanMs?: number;
};

export type PersistedTranscript = {
  readonly v: number;
  readonly actions: readonly PersistedSessionAction[];
};

export type TranscriptPersistInput = PersistRecordingSummaryInput & {
  readonly provider: ReplaySourceKind;
  readonly sessionKey: string | null;
  readonly sessionGroupingVersion: number | null;
  readonly actions: PersistedTranscript | null;
  readonly actionsVersion: number | null;
  readonly actionsOmitted: number | null;
  readonly pullStop: TranscriptPullStop | null;
  readonly pullReason: string | null;
  readonly pullWatermarkAt: Date | null;
};

export type TranscriptRecord = RecordingSummaryRecord & {
  readonly provider: ReplaySourceKind | null;
  readonly sessionKey: string | null;
  readonly sessionGroupingVersion: number | null;
  readonly actions: PersistedTranscript | null;
  readonly actionsVersion: number | null;
  readonly actionsOmitted: number | null;
  readonly pullStop: TranscriptPullStop | null;
  readonly pullReason: string | null;
  readonly pullWatermarkAt: Date | null;
};

export type SessionRecordingCitation = {
  readonly sessionId: string;
  readonly recordingId: string;
  readonly provider: ReplaySourceKind;
  readonly transcriptVersion: number | null;
  readonly actions: readonly PersistedSessionAction[] | null;
  readonly omitted: number;
  readonly pullStop: TranscriptPullStop | null;
  readonly pullReason: string | null;
};

export type TranscriptRefreshInput = {
  readonly projectId: string;
  readonly recordingId: string;
  readonly transcript: string;
  readonly pages: readonly string[];
  readonly durationMs: number;
  readonly actionCount: number;
  readonly notableCount: number;
  readonly droppedEvents: number;
  readonly actions: PersistedTranscript | null;
  readonly actionsVersion: number | null;
  readonly actionsOmitted: number | null;
  readonly pullStop: TranscriptPullStop | null;
  readonly pullReason: string | null;
  readonly pullWatermarkAt: Date | null;
  readonly bytesReceived: number | null;
};

export interface TranscriptRepoUnderContract {
  persist(input: TranscriptPersistInput): Promise<TranscriptRecord>;
  findFor(projectId: string, recordingId: string): Promise<TranscriptRecord | null>;
  summarisedIds(projectId: string, recordingIds: readonly string[]): Promise<Set<string>>;
  retryablePullIds(projectId: string, recordingIds: readonly string[]): Promise<Set<string>>;
  refreshFailedPull(input: TranscriptRefreshInput): Promise<TranscriptRecord | null>;
  latestStartedAt(projectId: string): Promise<Date | null>;
  citationsFor(
    projectId: string,
    sessionIds: readonly string[],
  ): Promise<readonly SessionRecordingCitation[]>;
}

export function transcriptRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): TranscriptRepoUnderContract {
  return createRecordingSummariesRepo(db, ctx) as unknown as TranscriptRepoUnderContract;
}

export function citationsFor(
  repo: TranscriptRepoUnderContract,
  projectId: string,
  sessionIds: readonly string[],
): Promise<readonly SessionRecordingCitation[]> {
  const method = (repo as unknown as Record<string, unknown>).citationsFor;

  if (typeof method !== "function") {
    throw new Error(
      "RecordingSummariesRepo declares no citationsFor. ADD §6.1 requires " +
        "citationsFor(projectId, sessionIds): Promise<readonly SessionRecordingCitation[]>, " +
        "joining sessions.session_key to recording_summaries.session_key with both sides " +
        "carrying their own organization predicate.",
    );
  }

  return repo.citationsFor(projectId, sessionIds);
}

export function recordingSessionKey(
  provider: ReplaySourceKind,
  recordingId: string,
): string | null {
  const exported = (shared as unknown as Record<string, unknown>).recordingSessionKey;

  if (typeof exported !== "function") {
    throw new Error(
      "@growthmind/shared exports no recordingSessionKey. ADD §5.2 requires it beside " +
        "deriveSessionKey, so the join key has one home in the monorepo.",
    );
  }

  return (exported as (kind: ReplaySourceKind, id: string) => string | null)(provider, recordingId);
}

export function transcriptOf(actions: readonly PersistedSessionAction[]): PersistedTranscript {
  return { v: 1, actions };
}

export const SESSION_GROUPING_VERSION = shared.SESSION_GROUPING_VERSION;
