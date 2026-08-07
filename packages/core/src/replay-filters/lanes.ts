import type {
  Origin,
  ReplayLane,
  ReplaySessionFact,
  StampedExclusionReason,
} from "@growthmind/shared";

// The count-time member `outside_who_counts` is never written to the column, so it is not a key
// here. See .ai/ux/o-050-replays-filters.md R-6.
export const LANE_BY_EXCLUSION_REASON: Record<StampedExclusionReason, ReplayLane> = {
  none: "real",
  internal_domain: "excluded",
  automation_headless: "excluded",
  automation_known_agent: "excluded",
  automation_coding_agent: "excluded",
};

// Two total maps rather than ordered branches: synthetic origin wins over any exclusion reason
// because it never consults one, so the partition holds by construction and not by the order
// somebody wrote the ifs in.
const LANE_BY_ORIGIN: Record<Origin, (reason: StampedExclusionReason) => ReplayLane> = {
  synthetic: () => "simulated",
  real: (reason) => LANE_BY_EXCLUSION_REASON[reason],
};

export function laneOf(session: ReplaySessionFact): ReplayLane {
  return LANE_BY_ORIGIN[session.origin](session.exclusionReason);
}
