import type { RrwebEvent } from "@growthmind/shared";

import { toActions } from "./actions";
import { readReplayEvents } from "./parse";
import type { SessionAction, SessionTranscript, TranscriptCounts } from "./types";

const NO_COUNTS: TranscriptCounts = {
  clicks: 0,
  deadClicks: 0,
  rageClicks: 0,
  refocuses: 0,
  abandonedFields: 0,
  scrollBacks: 0,
};

function tally(actions: readonly SessionAction[]): TranscriptCounts {
  const counted = { ...NO_COUNTS };

  for (const action of actions) {
    if (action.kind === "click") counted.clicks += 1;
    else if (action.kind === "dead_click") counted.deadClicks += 1;
    else if (action.kind === "rage_click") counted.rageClicks += 1;
    else if (action.kind === "field_refocus") counted.refocuses += 1;
    else if (action.kind === "field_abandoned") counted.abandonedFields += 1;
    else if (action.kind === "scroll_back") counted.scrollBacks += 1;
  }

  return counted;
}

function pagesOf(actions: readonly SessionAction[]): readonly string[] {
  const seen = new Set<string>();
  for (const action of actions) {
    if (action.kind === "page") seen.add(action.href);
  }
  return [...seen];
}

export function buildTranscript(events: readonly RrwebEvent[]): SessionTranscript {
  const { dropped, firstTsMs, lastTsMs } = readReplayEvents(events);
  const actions = toActions(events);

  return {
    actions,
    startedAt: firstTsMs === null ? null : new Date(firstTsMs),
    durationMs: firstTsMs === null || lastTsMs === null ? 0 : lastTsMs - firstTsMs,
    pages: pagesOf(actions),
    counts: tally(actions),
    droppedEvents: dropped,
  };
}
