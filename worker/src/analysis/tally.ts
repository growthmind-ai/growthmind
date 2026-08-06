import type { AnalysisOutcome } from "@growthmind/shared";

import type { AnalysisLane, CallAttribution } from "./types";

export type RunTally = {
  modelCallsAttempted: number;
  resolvedModelId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  findingsPersisted: number;
  unrenderable: number;
  refused: number;
  // In-memory/log-only (ADD o-019-dismissal-wired Decision 5 item 6) — never passed into
  // runs.close()'s persisted columns; the PRD's Data Requirements rule out a new column.
  suppressed: number;
  capExhausted: boolean;
};

export function newTally(): RunTally {
  return {
    modelCallsAttempted: 0,
    resolvedModelId: null,

    tokensIn: null,
    tokensOut: null,
    findingsPersisted: 0,
    unrenderable: 0,
    refused: 0,
    suppressed: 0,
    capExhausted: false,
  };
}

export function addReported(total: number | null, reported: number | undefined): number | null {
  if (reported === undefined) return total;
  return (total ?? 0) + reported;
}

export function applyAttribution(tally: RunTally, attribution: CallAttribution): void {
  if (!attribution.attempted) return;
  tally.modelCallsAttempted += 1;

  tally.resolvedModelId ??= attribution.resolvedModelId;
  tally.tokensIn = addReported(tally.tokensIn, attribution.usage.inputTokens);
  tally.tokensOut = addReported(tally.tokensOut, attribution.usage.outputTokens);
}

export function outcomeFor(lane: AnalysisLane): AnalysisOutcome {
  if (lane.candidates.length > 0) return "produced_findings";
  return lane.sessionsConsidered > 0 ? "no_candidates_passed_gate" : "no_sessions_to_analyse";
}
