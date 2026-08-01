// What a run will say when it closes. Accumulated as candidates are walked.
//
// Every function here is pure in the sense that matters: no I/O, no clock, no logger,
// no repository. `applyAttribution` mutates the tally it is handed and returns nothing,
// which is a deliberate choice rather than an oversight. The walk is a loop over
// candidates and a fold that allocated a fresh tally per candidate would read worse for
// no gain. The mutation is confined to a value the caller owns and never escapes this
// module's callers.
//
// Kept apart from the ladder because it answers a different question. `plan.ts` decides
// what happens to one candidate; this decides what the run row says about all of them,
// and every exit path (ordinary, refused or thrown) closes from one accumulated set of
// facts rather than from a value some branch forgot to set.
import type { AnalysisOutcome } from "@growthmind/shared";

import type { AnalysisLane, CallAttribution } from "./types";

/** What the run row will say when it closes. Mutated as candidates are processed, so
 * every exit path closes from one accumulated set of facts. */
export type RunTally = {
  modelCallsAttempted: number;
  resolvedModelId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  findingsPersisted: number;
  unrenderable: number;
  refused: number;
  capExhausted: boolean;
};

export function newTally(): RunTally {
  return {
    modelCallsAttempted: 0,
    resolvedModelId: null,
    // NULL means not reported, never `0`. A run whose calls all went unmetered must not
    // read as a run that cost nothing, so a token total only becomes a number once
    // something reported one.
    tokensIn: null,
    tokensOut: null,
    findingsPersisted: 0,
    unrenderable: 0,
    refused: 0,
    capExhausted: false,
  };
}

/**
 * Adds a reported token count to a running total, preserving the not-reported/zero
 * distinction.
 *
 * `undefined` in leaves the total exactly as it was, including `null`. Only a genuinely
 * reported number promotes a `null` total to `0 + reported`.
 */
export function addReported(total: number | null, reported: number | undefined): number | null {
  if (reported === undefined) return total;
  return (total ?? 0) + reported;
}

export function applyAttribution(tally: RunTally, attribution: CallAttribution): void {
  if (!attribution.attempted) return;
  tally.modelCallsAttempted += 1;
  // The first model actually addressed. `null` on a closed run therefore means no call
  // was attempted at all, never that one was attempted and failed. That holds because
  // `CallAttribution`'s `attempted: true` arm cannot carry a null id: this aggregate is
  // only as true as its inputs, and a run whose every call threw used to close with
  // `modelCallsAttempted > 0` beside a null model id.
  tally.resolvedModelId ??= attribution.resolvedModelId;
  tally.tokensIn = addReported(tally.tokensIn, attribution.usage.inputTokens);
  tally.tokensOut = addReported(tally.tokensOut, attribution.usage.outputTokens);
}

/**
 * What a completed run found. Read off facts, never guessed.
 *
 * The two zeros stay distinct: "we have not looked yet" and "we looked and your product
 * was quiet" are different answers, and only the lane source knows which applies.
 *
 * On a failed run this answers `produced_findings` whenever the lane had candidates at
 * all, including when none of them landed. That direction is deliberate: a run that
 * broke must never report the shape of an empty product, because "we could not finish"
 * read as "there was nothing to find" is the same false reassurance SAC-10 exists to
 * prevent one level up.
 */
export function outcomeFor(lane: AnalysisLane): AnalysisOutcome {
  if (lane.candidates.length > 0) return "produced_findings";
  return lane.sessionsConsidered > 0 ? "no_candidates_passed_gate" : "no_sessions_to_analyse";
}
