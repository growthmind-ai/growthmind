import type { CauseClaim } from "./types";

// Per-claim citation gate for the cause stage (ADD Decision 6, gate 2). Runs
// only after guardCauseText has already passed the whole response — a claim
// can never be dropped here for content it was already whole-response-refused
// for.
//
// A claim survives iff it cites at least one beat and every cited index is in
// range. A claim citing a mix of valid and out-of-range indices is dropped
// whole, never trimmed to keep the valid citations (FR-2).

export type CitationGateResult = {
  readonly survivors: readonly CauseClaim[];
  readonly droppedCount: number;
};

export function applyCitationGate(
  claims: readonly { readonly statement: string; readonly citesBeats: readonly number[] }[],
  beatCount: number,
): CitationGateResult {
  const survivors: CauseClaim[] = [];
  let droppedCount = 0;

  for (const claim of claims) {
    const cited = claim.citesBeats.length > 0;
    const inRange = claim.citesBeats.every((index) => index >= 0 && index < beatCount);

    if (cited && inRange) {
      survivors.push({ statement: claim.statement, citesBeats: claim.citesBeats });
    } else {
      droppedCount += 1;
    }
  }

  return { survivors, droppedCount };
}
