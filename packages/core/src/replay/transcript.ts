import type { RrwebEvent } from "@growthmind/shared";

import { walkActions } from "./actions";
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

export function tallyActions(actions: readonly SessionAction[]): TranscriptCounts {
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

export function pagesOfActions(actions: readonly SessionAction[]): readonly string[] {
  const seen = new Set<string>();
  for (const action of actions) {
    if (action.kind === "page") seen.add(action.href);
  }
  return [...seen];
}

export function buildTranscript(
  events: readonly RrwebEvent[],
  clockOriginAtMs: number | null = null,
): SessionTranscript {
  const { dropped, firstTsMs, lastTsMs } = readReplayEvents(events);
  const walk = walkActions(events, clockOriginAtMs);

  // Measured from the shared clock when there is one, so a resumed half reports how far into
  // the recording it reached rather than how long its own slice of it ran.
  const spanFrom = clockOriginAtMs ?? firstTsMs;

  return {
    actions: walk.actions,
    startedAt: firstTsMs === null ? null : new Date(firstTsMs),
    clockOriginAtMs: walk.clockOriginAtMs,
    durationMs: spanFrom === null || lastTsMs === null ? 0 : lastTsMs - spanFrom,
    pages: pagesOfActions(walk.actions),
    counts: tallyActions(walk.actions),
    droppedEvents: dropped,
  };
}
