// Unit tests for ordering: the deterministic within-session ordering key.
//
// What the tie-break actually promises `source_event_id` happens to be a UUIDv7 in this
// deployment and therefore happens to sort by time, but
// `packages/db/src/schema/events.ts:51-56` is explicit that this is "an observation
// rather than a contract". So the only contract the tie-break carries is determinism,
// never chronology.
//
// Every fixture below is built to hold that line:
//
// * No id here is a UUIDv7, or a UUID at all. An implementation that parsed
//  the id for an embedded instant would not survive `alpha-tied`.
// * The ids are deliberately anti-correlated with time. In the ascending
//  fixture the chronologically first event carries the lexicographically
//  Last id, so an implementation that sorted by id alone fails test 1.
// * In the tie fixture the expected output is the exact reverse of the input
//  order, so an implementation that compared only `occurredAt` — leaving
//  ties in arrival order under a stable sort — fails test 2.
//
// Together those two facts pin the composite key `(occurredAt ASC, sourceEventId ASC)`
// and nothing weaker. The suite would still pass verbatim if the id format changed
// tomorrow, because it never reads meaning out of an id, only order.
//
// Fixture time is a required parameter. There is no `Date.now` and no ambient clock
// anywhere in this file: `at` takes its base instant as an argument, so nothing here
// can be time-of-day flaky.
import { describe, expect, test } from "bun:test";

import { orderTimeline } from "../../src/detect/order";
import type { TimelineEvent } from "../../src/detect/types";

/**
 * The suite's one fixed instant. Passed explicitly into every `at` call (never read
 * as a module-level default) so the required-parameter discipline is enforced by the
 * signature rather than by convention.
 */
const FIXTURE_BASE = new Date("2026-03-01T09:00:00.000Z");

/** A fixture instant, derived from a required base. No ambient clock. */
function at(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

function timelineEvent(sourceEventId: string, occurredAt: Date): TimelineEvent {
  return {
    sourceEventId,
    name: "$pageview",
    occurredAt,
    urlPath: "/checkout",
    urlPathNormalisationVersion: 1,
  };
}

const idsOf = (events: readonly TimelineEvent[]): readonly string[] =>
  events.map((event) => event.sourceEventId);

/**
 * A deterministic, order-sensitive serialisation of a whole timeline, used for the
 * byte-identity assertion. Written out field by field rather than projected into
 * positional arrays first, so the comparison cannot silently depend on object key
 * insertion order, and `null` stays distinguishable from the string `"null"`. Dates are
 * pinned to ISO rather than left to a locale-sensitive default.
 */
function serialiseTimeline(events: readonly TimelineEvent[]): string {
  return JSON.stringify(
    events.map((event) => [
      event.sourceEventId,
      event.name,
      event.occurredAt.toISOString(),
      event.urlPath,
      event.urlPathNormalisationVersion,
    ]),
  );
}

/**
 * Three distinct instants whose ids run the other way: `zulu` is earliest and sorts
 * last by id; `alpha` is latest and sorts first. Ordering by id alone produces the
 * exact reverse of the expected answer.
 */
function ascendingFixture(base: Date): readonly TimelineEvent[] {
  return [
    timelineEvent("mike-second-in-time", at(base, 1_000)),
    timelineEvent("alpha-third-in-time", at(base, 2_000)),
    timelineEvent("zulu-first-in-time", at(base, 0)),
  ];
}

/**
 * Three events sharing one instant exactly. Input order is `zulu, mike, alpha`;
 * lexicographic id order is `alpha, mike, zulu`. The exact reverse. A stable sort keyed
 * on `occurredAt` alone would return the input order untouched and fail, which is the
 * whole point of.
 */
function tiedFixture(base: Date): readonly TimelineEvent[] {
  const tie = at(base, 5_000);
  return [
    timelineEvent("zulu-tied", tie),
    timelineEvent("mike-tied", tie),
    timelineEvent("alpha-tied", tie),
  ];
}

/**
 * All six arrival orders of the three tied events, written out rather than generated.
 * The corpus read hands its rows over in whatever order the driver produced them; the
 * ordered timeline must be the same for every one of them.
 */
const ARRIVAL_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

describe("orderTimeline", () => {
  test("should order a timeline by occurred_at ascending", () => {
    const input = ascendingFixture(FIXTURE_BASE);

    const ordered = orderTimeline(input);

    // Chronological, not lexicographic: `zulu` is first because it happened first, even
    // though its id sorts last.
    expect(idsOf(ordered)).toEqual([
      "zulu-first-in-time",
      "mike-second-in-time",
      "alpha-third-in-time",
    ]);
    expect(ordered.map((event) => event.occurredAt.toISOString())).toEqual([
      at(FIXTURE_BASE, 0).toISOString(),
      at(FIXTURE_BASE, 1_000).toISOString(),
      at(FIXTURE_BASE, 2_000).toISOString(),
    ]);
    // The events themselves are carried through whole. A re-sort, not a rewrite.
    // Nothing is dropped, added, or re-authored.
    expect(ordered).toHaveLength(input.length);
    expect(ordered).toEqual([input[2], input[0], input[1]]);
  });

  test("should break identical occurred_at ties by source_event_id ascending, stably across repeated runs", () => {
    const input = tiedFixture(FIXTURE_BASE);
    const expected = ["alpha-tied", "mike-tied", "zulu-tied"];

    // Ascending by id, which here is the exact reverse of the order the events arrived
    // in, so "left them alone" cannot be mistaken for "broke the tie".
    expect(idsOf(orderTimeline(input))).toEqual(expected);

    // Stable across repeated runs: same input, called again and again.
    for (let run = 0; run < 5; run += 1) {
      expect(idsOf(orderTimeline(input))).toEqual(expected);
    }

    // Stable across arrival order too: whichever order the corpus read happened to hand
    // these over, the timeline is the same. This is what makes the detector's
    // determinism independent of the database honouring an order by.
    for (const arrivalOrder of ARRIVAL_ORDERS) {
      const permutation = arrivalOrder.map((index) => input[index]);
      expect(idsOf(orderTimeline(permutation))).toEqual(expected);
    }
  });

  test("should produce byte-identical output when called twice with identical input", () => {
    // Two structurally identical inputs built independently, mixing distinct instants
    // with a tie so both halves of the composite key are exercised.
    const buildInput = (): readonly TimelineEvent[] => [
      ...ascendingFixture(FIXTURE_BASE),
      ...tiedFixture(FIXTURE_BASE),
    ];

    const first = serialiseTimeline(orderTimeline(buildInput()));
    const second = serialiseTimeline(orderTimeline(buildInput()));

    expect(second).toBe(first);
    // Byte-identity must not be satisfied vacuously: an implementation that returned an
    // empty timeline would be trivially reproducible.
    expect(JSON.parse(first)).toHaveLength(6);

    // And byte-identical when the same array is passed twice. The function carries no
    // state between calls (no clock, no randomness).
    const shared = buildInput();
    expect(serialiseTimeline(orderTimeline(shared))).toBe(first);
    expect(serialiseTimeline(orderTimeline(shared))).toBe(first);
  });

  test("should not mutate the array it was given", () => {
    // Purity: the corpus's array belongs to the caller. An in-place `.sort` would
    // make a second detector reading the same session see a timeline the first one
    // reordered underneath it.
    const input = [...ascendingFixture(FIXTURE_BASE), ...tiedFixture(FIXTURE_BASE)];
    const idsBefore = idsOf(input);
    const serialisedBefore = serialiseTimeline(input);

    orderTimeline(input);

    expect(idsOf(input)).toEqual(idsBefore);
    expect(serialiseTimeline(input)).toBe(serialisedBefore);
  });
});
