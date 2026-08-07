import type { FacetOption } from "@growthmind/core";
import {
  REPLAY_CLEAR_COMPANY_ACTION,
  REPLAY_CLEAR_ENTRY_ACTION,
  REPLAY_COMPANY_AXIS,
  REPLAY_COMPANY_PANEL_FOOT,
  REPLAY_COMPANY_REST_LABEL,
  REPLAY_COMPANY_SEARCH_PLACEHOLDER,
  REPLAY_DEFAULT_LANE,
  REPLAY_ENTRY_AXIS,
  REPLAY_ENTRY_PANEL_FOOT,
  REPLAY_ENTRY_REST_LABEL,
  REPLAY_ENTRY_SEARCH_PLACEHOLDER,
  REPLAY_FILTER_PARAMS,
  REPLAY_LANE_DESCRIPTIONS,
  REPLAY_LANE_TITLES,
  REPLAY_LANES,
  REPLAY_SHOW_REAL_PEOPLE_AGAIN_ACTION,
  REPLAY_WHO_AXIS,
} from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import type { ReplayFacets } from "@/lib/replay/read";

import type { FilterDescriptor, FilterOption } from "./types";

function optionsOf(facet: readonly FacetOption[]): readonly FilterOption[] {
  return facet.map((option) => ({
    value: option.value,
    label: option.value,
    description: null,
    sessionCount: option.sessionCount,
    replayCount: option.replayCount,
  }));
}

export function replayDescriptors(
  facets: ReplayFacets,
  filters: ReplayFilters,
): readonly FilterDescriptor[] {
  const counted = new Map(facets.whoCounts.map((count) => [count.value, count]));

  const lanes: readonly FilterOption[] = REPLAY_LANES.map((lane) => {
    const count = counted.get(lane);

    return {
      value: lane,
      label: REPLAY_LANE_TITLES[lane],
      description: REPLAY_LANE_DESCRIPTIONS[lane],
      sessionCount: count?.sessionCount ?? null,
      replayCount: count?.replayCount ?? null,
    };
  });

  return [
    {
      param: REPLAY_FILTER_PARAMS.company,
      restLabel: REPLAY_COMPANY_REST_LABEL,
      kind: "list",
      panelSize: [320, 326],
      searchPlaceholder: REPLAY_COMPANY_SEARCH_PLACEHOLDER,
      footNote: REPLAY_COMPANY_PANEL_FOOT,
      options: optionsOf(facets.company),
      value: filters.company,
      axis: REPLAY_COMPANY_AXIS,
      clearLabel: REPLAY_CLEAR_COMPANY_ACTION,
    },
    {
      // Deliberately the same size as the one above: the proof the engine generalises is that a
      // different accessor needs no new size (UX R-1).
      param: REPLAY_FILTER_PARAMS.entry,
      restLabel: REPLAY_ENTRY_REST_LABEL,
      kind: "list",
      panelSize: [320, 326],
      searchPlaceholder: REPLAY_ENTRY_SEARCH_PLACEHOLDER,
      footNote: REPLAY_ENTRY_PANEL_FOOT,
      options: optionsOf(facets.entry),
      value: filters.entry,
      axis: REPLAY_ENTRY_AXIS,
      clearLabel: REPLAY_CLEAR_ENTRY_ACTION,
    },
    {
      param: REPLAY_FILTER_PARAMS.who,
      restLabel: REPLAY_LANE_TITLES[REPLAY_DEFAULT_LANE],
      kind: "segment",
      panelSize: [300, 224],
      searchPlaceholder: null,
      footNote: null,
      options: lanes,
      // The baseline is never an applied filter, so at rest this descriptor carries no value and
      // its pill takes no accent and no clear control (UX T10).
      value: filters.lane === REPLAY_DEFAULT_LANE ? null : filters.lane,
      axis: REPLAY_WHO_AXIS,
      clearLabel: REPLAY_SHOW_REAL_PEOPLE_AGAIN_ACTION,
    },
  ];
}
