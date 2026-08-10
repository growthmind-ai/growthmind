import type { ExclusionReason } from "@growthmind/shared";
import { EXCLUSION_REASON_LABELS } from "@growthmind/shared";

import type { SetAsideBasis } from "./measured-count";

export type SetAsideUnit = "events" | "sessions";

export type SetAsideTally = {
  readonly unit: SetAsideUnit;

  readonly countsByReason: Iterable<readonly [ExclusionReason, number]>;
};

export function buildSetAsideBreakdown(tally: SetAsideTally): SetAsideBasis[] {
  return [...tally.countsByReason]
    .map(([reason, count]) => ({
      reason,
      count,

      label: EXCLUSION_REASON_LABELS[reason],
    }))
    .toSorted((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));
}
