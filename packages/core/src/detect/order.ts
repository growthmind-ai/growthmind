import type { TimelineEvent } from "./types";

function compareIdsAscending(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export function orderTimeline(events: readonly TimelineEvent[]): readonly TimelineEvent[] {
  return events.toSorted((left, right) => {
    const byInstant = left.occurredAt.getTime() - right.occurredAt.getTime();
    if (byInstant !== 0) {
      return byInstant;
    }
    return compareIdsAscending(left.sourceEventId, right.sourceEventId);
  });
}
