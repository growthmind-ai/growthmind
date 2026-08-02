import type { ExclusionReason, SetAsideBreakdown } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";

export type SetAsideUnit = "events" | "sessions";

export interface SetAsideTally {
  readonly unit: SetAsideUnit;

  readonly countsByReason: Iterable<readonly [ExclusionReason, number]>;
}

export function buildSetAsideBreakdown(tally: SetAsideTally): SetAsideBreakdown[] {
  return [...tally.countsByReason]
    .map(([reason, count]) => ({
      reason,
      count,

      label: EXCLUSION_REASON_LABELS[reason],
    }))
    .toSorted((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
