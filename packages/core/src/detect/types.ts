import type { ConnectionState, ExclusionReason, SessionCohortCuts } from "@growthmind/shared";
import { z } from "zod";

import type { CountBasis, MeasuredCount } from "../counts/measured-count";
import type { EvidenceSignal } from "../evidence/signals";
import type { SessionTranscript } from "../replay/types";
import type { DetectorName, DetectorProposedClass } from "../rules/types";

export const DETECTOR_CORPUS_MAX_SESSIONS = 500;

export type TimelineEvent = {
  readonly sourceEventId: string;
  readonly name: string;

  readonly occurredAt: Date;

  readonly urlPath: string | null;

  readonly urlPathNormalisationVersion: number | null;
};

export type SessionTimeline = {
  readonly sessionId: string;
  readonly startedAt: Date;

  readonly exclusionReason: ExclusionReason;
  readonly entryUrlPath: string | null;
  readonly events: readonly TimelineEvent[];

  // Derived at the corpus boundary. There is deliberately no raw user-agent field here, so no
  // detector, artifact or payload downstream can carry the string these were classified from.
  readonly cohortCuts?: SessionCohortCuts;
};

export type AnalysisWindow = {
  readonly start: Date;
  readonly end: Date;
};

export const analysisWindowSchema = z.object({
  start: z.date(),
  end: z.date(),
});

export type DetectorCoverage = {
  readonly truncated: boolean;

  readonly eventsWithoutUrlPath: number;
};

export const detectorCoverageSchema = z.object({
  truncated: z.boolean(),
  eventsWithoutUrlPath: z.number().int().nonnegative(),
});

export type SessionReplay = {
  readonly sessionId: string;
  readonly transcript: SessionTranscript;
};

export type DetectorCorpus = {
  readonly projectId: string;
  readonly window: AnalysisWindow;
  readonly connectionState: ConnectionState;

  readonly sessions: readonly SessionTimeline[];

  readonly replays?: readonly SessionReplay[];

  readonly basis: CountBasis;
  readonly coverage: DetectorCoverage;
};

export const claimSubjectSchema = z.literal("surface");
export type ClaimSubject = z.infer<typeof claimSubjectSchema>;

export type DetectorCandidate = {
  readonly detector: DetectorName;
  readonly claimedClass: DetectorProposedClass;

  readonly claimSubject: ClaimSubject;

  readonly surface: string;

  readonly surfaceNormalisationVersion: number | null;
  readonly signals: readonly EvidenceSignal[];
  readonly counts: readonly MeasuredCount[];
  readonly timeframe: AnalysisWindow;

  readonly coverage: DetectorCoverage;
};

export type DetectorResult = {
  readonly detector: DetectorName;
  readonly connectionState: ConnectionState;
  readonly coverage: DetectorCoverage;
  readonly candidates: readonly DetectorCandidate[];
};
