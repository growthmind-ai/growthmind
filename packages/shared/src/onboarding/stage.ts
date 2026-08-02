import type { AnalysisOutcome, AnalysisRunStatus } from "../summary/types";
import type { EndedReason, OnboardingFinding } from "./types";

export type StagePersistedFacts = {
  readonly armedAt: Date | null;

  readonly retrievedAt: Date | null;

  readonly readingAt: Date | null;
  readonly endedAt: Date | null;
  readonly runStatus: AnalysisRunStatus | null;
  readonly runOutcome: AnalysisOutcome | null;
  readonly finding: OnboardingFinding | null;
};

type StageMilestones = {
  readonly retrievedAtSeconds: number | null;
  readonly readingAtSeconds: number | null;
};

export type RenderedStageState =
  | { readonly kind: "unarmed" }
  | ({ readonly kind: "leg1"; readonly elapsedSeconds: number } & StageMilestones)
  | ({ readonly kind: "leg2"; readonly elapsedSeconds: number } & StageMilestones)
  | ({
      readonly kind: "finding";
      readonly elapsedSeconds: number;
      readonly finding: OnboardingFinding;
    } & StageMilestones)
  | ({
      readonly kind: "ended";
      readonly elapsedSeconds: number;
      readonly reason: EndedReason;
    } & StageMilestones);

function wholeSecondsBetween(originMs: number, atMs: number): number {
  return Math.max(0, Math.round((atMs - originMs) / 1000));
}

function offsetOf(moment: Date | null, originMs: number): number | null {
  return moment === null ? null : wholeSecondsBetween(originMs, moment.getTime());
}

function endedReasonFor(
  runStatus: AnalysisRunStatus | null,
  runOutcome: AnalysisOutcome | null,
): EndedReason | null {
  if (runStatus === "failed") {
    return "failed";
  }

  if (runStatus === "completed" && runOutcome !== null && runOutcome !== "produced_findings") {
    return runOutcome;
  }

  return null;
}

export function reduceStage(facts: StagePersistedFacts, nowMs: number): RenderedStageState {
  const armedMs = facts.armedAt === null ? null : facts.armedAt.getTime();

  const milestones: StageMilestones =
    armedMs === null
      ? { retrievedAtSeconds: null, readingAtSeconds: null }
      : {
          retrievedAtSeconds: offsetOf(facts.retrievedAt, armedMs),
          readingAtSeconds: offsetOf(facts.readingAt, armedMs),
        };

  const waitingElapsed = armedMs === null ? 0 : wholeSecondsBetween(armedMs, nowMs);
  const terminalElapsed =
    armedMs === null
      ? 0
      : wholeSecondsBetween(armedMs, facts.endedAt === null ? nowMs : facts.endedAt.getTime());

  if (facts.finding !== null) {
    return {
      kind: "finding",
      elapsedSeconds: terminalElapsed,
      finding: facts.finding,
      ...milestones,
    };
  }

  if (armedMs === null) {
    return { kind: "unarmed" };
  }

  const reason = endedReasonFor(facts.runStatus, facts.runOutcome);
  if (reason !== null) {
    return { kind: "ended", elapsedSeconds: terminalElapsed, reason, ...milestones };
  }

  if (facts.readingAt !== null) {
    return { kind: "leg2", elapsedSeconds: waitingElapsed, ...milestones };
  }

  return { kind: "leg1", elapsedSeconds: waitingElapsed, ...milestones };
}
