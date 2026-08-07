import {
  REPLAY_CLEAR_ALL_ACTION,
  REPLAY_CLEAR_COMPANY_ACTION,
  REPLAY_CLEAR_ENTRY_ACTION,
  REPLAY_DEFAULT_LANE,
  REPLAY_NONE_YET_ACTION,
  REPLAY_NONE_YET_BODY,
  REPLAY_OVER_FILTERED_COMBINATION_BODY,
  REPLAY_OVER_FILTERED_COMPANY_BODY,
  REPLAY_OVER_FILTERED_ENTRY_ALONE_BODY,
  REPLAY_OVER_FILTERED_ENTRY_WITH_COMPANY_BODY,
  REPLAY_OVER_FILTERED_LANE_BODY,
  REPLAY_SHOW_REAL_PEOPLE_AGAIN_ACTION,
} from "@growthmind/shared";
import type { ReplayFilters, ReplaySessionFact } from "@growthmind/shared";

import { fill } from "./template";

export type ReplayRelaxTarget = "company" | "entry" | "lane";

export type ReplayWayOut = { readonly relax: ReplayRelaxTarget } | "clear_all" | "no_replays_yet";

// The terminal states of ADD D-11, as one value the pure body renders. The way out owns the copy
// for the three above; the rest carry values the tag alone does not hold.
export type ReplayOutcome =
  | ReplayWayOut
  | "rows"
  | "nothing_left_out"
  | "simulated_permanent_zero"
  | "zero_replays_for_selection"
  | "value_matches_nothing";

export interface WayOutInput {
  readonly filters: ReplayFilters;

  // What each active filter would restore if it alone were relaxed. All three are in-memory
  // passes over reads the screen already holds.
  readonly relaxingCompany: readonly ReplaySessionFact[];
  readonly relaxingEntry: readonly ReplaySessionFact[];
  readonly relaxingLane: readonly ReplaySessionFact[];
}

interface ActiveFilter {
  readonly target: ReplayRelaxTarget;
  readonly on: boolean;
  readonly restored: readonly ReplaySessionFact[];
}

export function wayOut(input: WayOutInput): ReplayWayOut {
  const { filters } = input;

  const all: readonly ActiveFilter[] = [
    { target: "company", on: filters.company !== null, restored: input.relaxingCompany },
    { target: "entry", on: filters.entry !== null, restored: input.relaxingEntry },
    { target: "lane", on: filters.lane !== REPLAY_DEFAULT_LANE, restored: input.relaxingLane },
  ];

  const active = all.filter((filter) => filter.on);
  const culprits = active.filter((filter) => filter.restored.length > 0);

  const only = culprits.length === 1 ? culprits[0] : undefined;
  if (only !== undefined) return { relax: only.target };

  // Two or more active with no single culprit still has a way out — clearing them all. One
  // active filter whose relaxation restores nothing means the lane itself is empty, which is a
  // different state with a different action.
  return active.length >= 2 ? "clear_all" : "no_replays_yet";
}

const RELAX_ACTIONS: Record<ReplayRelaxTarget, string> = {
  company: REPLAY_CLEAR_COMPANY_ACTION,
  entry: REPLAY_CLEAR_ENTRY_ACTION,
  // The default lane is a stated baseline, never an applied filter, so this returns to it
  // rather than clearing anything (UX T10).
  lane: REPLAY_SHOW_REAL_PEOPLE_AGAIN_ACTION,
};

export function wayOutAction(outcome: ReplayOutcome): string | null {
  if (typeof outcome !== "string") return RELAX_ACTIONS[outcome.relax];
  if (outcome === "clear_all") return REPLAY_CLEAR_ALL_ACTION;
  if (outcome === "no_replays_yet") return REPLAY_NONE_YET_ACTION;
  return null;
}

function culpritBody(relax: ReplayRelaxTarget, filters: ReplayFilters): string | null {
  const { company, entry } = filters;

  if (relax === "lane") return REPLAY_OVER_FILTERED_LANE_BODY;

  if (relax === "entry") {
    if (entry === null) return null;
    return company === null
      ? fill(REPLAY_OVER_FILTERED_ENTRY_ALONE_BODY, { entry })
      : fill(REPLAY_OVER_FILTERED_ENTRY_WITH_COMPANY_BODY, { company, entry });
  }

  if (company === null || entry === null) return null;
  return fill(REPLAY_OVER_FILTERED_COMPANY_BODY, { company, entry });
}

export function wayOutBody(outcome: ReplayOutcome, filters: ReplayFilters): string | null {
  if (typeof outcome !== "string") return culpritBody(outcome.relax, filters);
  if (outcome === "clear_all") return REPLAY_OVER_FILTERED_COMBINATION_BODY;
  if (outcome === "no_replays_yet") return REPLAY_NONE_YET_BODY;
  return null;
}
