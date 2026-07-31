// The deterministic within-session ordering key (O-004 D-5, ES-9).
import type { TimelineEvent } from "./types";

/**
 * Ascending comparison of two ids by UTF-16 CODE UNIT — deliberately `<`/`>`
 * rather than `localeCompare`, whose collation is locale- and ICU-dependent and
 * would make the timeline's order a property of the machine it ran on. Nothing
 * is parsed out of the id: it is compared as an opaque string, so the ordering
 * survives any change to the id format (D-5).
 */
function compareIdsAscending(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Orders a session's events by `occurredAt` ASCENDING, ties broken by
 * `sourceEventId` ASCENDING.
 *
 * The composite key is TOTAL: `source_event_id` is unique per
 * `(project_id, source_event_id)` by the events table's own idempotency index,
 * so no two events in one project share both halves. DETERMINISM IS THE ONLY
 * CONTRACT the tie-break carries — `source_event_id` happens to be a UUIDv7 in
 * this deployment and therefore happens to sort by time, but the schema is
 * explicit that this is "an observation rather than a contract", and no code
 * or test here may justify the tie-break by that property.
 *
 * This is a PURE re-sort, applied even though the corpus read already emits
 * the same `ORDER BY`: the detector's determinism must not depend on the
 * database honouring an ordering it was handed, and a detector that re-sorts
 * is testable in isolation and identical either way.
 *
 * Stable and non-mutating: the input array is never reordered in place.
 * `toSorted` returns a new array, so the corpus's array — which belongs to the
 * caller and may be read by a second detector — is left exactly as it was
 * handed over. Elements are carried through by reference: this is a re-sort,
 * not a rewrite.
 */
export function orderTimeline(events: readonly TimelineEvent[]): readonly TimelineEvent[] {
  return events.toSorted((left, right) => {
    const byInstant = left.occurredAt.getTime() - right.occurredAt.getTime();
    if (byInstant !== 0) {
      return byInstant;
    }
    return compareIdsAscending(left.sourceEventId, right.sourceEventId);
  });
}
