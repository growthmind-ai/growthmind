import { REPLAY_DEFAULT_LANE, REPLAY_FILTER_PARAMS, replayLaneSchema } from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import { ROUTES } from "@/lib/routes";

// A param name spelled at a call site is a silent no-op waiting to happen: the reader keeps
// parsing one word while the writer starts writing another and nothing errors. Every param this
// module touches comes from REPLAY_FILTER_PARAMS.
const laneOf = replayLaneSchema.catch(REPLAY_DEFAULT_LANE);

export function replayFilterValue(filters: ReplayFilters, param: string): string | null {
  if (param === REPLAY_FILTER_PARAMS.company) return filters.company;
  if (param === REPLAY_FILTER_PARAMS.entry) return filters.entry;
  if (param === REPLAY_FILTER_PARAMS.who) {
    return filters.lane === REPLAY_DEFAULT_LANE ? null : filters.lane;
  }
  return null;
}

export function replayFiltersWith(
  filters: ReplayFilters,
  param: string,
  value: string | null,
): ReplayFilters {
  if (param === REPLAY_FILTER_PARAMS.company) return { ...filters, company: value };
  if (param === REPLAY_FILTER_PARAMS.entry) return { ...filters, entry: value };
  if (param === REPLAY_FILTER_PARAMS.who) {
    return { ...filters, lane: value === null ? REPLAY_DEFAULT_LANE : laneOf.parse(value) };
  }
  return filters;
}

// The bar rebuilds only the three known params, so a key nobody wrote is a documented ignore on
// read and is gone on the next write. The default lane is a stated baseline rather than an
// applied filter, so it is never written.
export function replayUrlOf(filters: ReplayFilters): string {
  const params = new URLSearchParams();

  if (filters.company !== null) params.set(REPLAY_FILTER_PARAMS.company, filters.company);
  if (filters.entry !== null) params.set(REPLAY_FILTER_PARAMS.entry, filters.entry);
  if (filters.lane !== REPLAY_DEFAULT_LANE) params.set(REPLAY_FILTER_PARAMS.who, filters.lane);

  const query = params.toString();
  return query === "" ? ROUTES.replays : `${ROUTES.replays}?${query}`;
}

function same(left: ReplayFilters, right: ReplayFilters): boolean {
  return left.company === right.company && left.entry === right.entry && left.lane === right.lane;
}

// Null when the change is not a change: applying the value already on, or clearing a filter that
// is already off, must not stack a second history entry behind two rapid clicks.
export function nextReplayUrl(
  filters: ReplayFilters,
  param: string,
  value: string | null,
): string | null {
  const next = replayFiltersWith(filters, param, value);
  return same(next, filters) ? null : replayUrlOf(next);
}

export function clearedReplayUrl(filters: ReplayFilters): string | null {
  const next: ReplayFilters = { company: null, entry: null, lane: REPLAY_DEFAULT_LANE };
  return same(next, filters) ? null : replayUrlOf(next);
}
