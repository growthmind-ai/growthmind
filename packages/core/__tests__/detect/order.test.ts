import { describe, expect, test } from "bun:test";

import { orderTimeline } from "../../src/detect/order";
import type { TimelineEvent } from "../../src/detect/types";

const FIXTURE_BASE = new Date("2026-03-01T09:00:00.000Z");

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

function ascendingFixture(base: Date): readonly TimelineEvent[] {
  return [
    timelineEvent("mike-second-in-time", at(base, 1_000)),
    timelineEvent("alpha-third-in-time", at(base, 2_000)),
    timelineEvent("zulu-first-in-time", at(base, 0)),
  ];
}

function tiedFixture(base: Date): readonly TimelineEvent[] {
  const tie = at(base, 5_000);
  return [
    timelineEvent("zulu-tied", tie),
    timelineEvent("mike-tied", tie),
    timelineEvent("alpha-tied", tie),
  ];
}

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

    expect(ordered).toHaveLength(input.length);
    expect(ordered).toEqual([input[2], input[0], input[1]]);
  });

  test("should break identical occurred_at ties by source_event_id ascending, stably across repeated runs", () => {
    const input = tiedFixture(FIXTURE_BASE);
    const expected = ["alpha-tied", "mike-tied", "zulu-tied"];

    expect(idsOf(orderTimeline(input))).toEqual(expected);

    for (let run = 0; run < 5; run += 1) {
      expect(idsOf(orderTimeline(input))).toEqual(expected);
    }

    for (const arrivalOrder of ARRIVAL_ORDERS) {
      const permutation = arrivalOrder.map((index) => input[index]);
      expect(idsOf(orderTimeline(permutation))).toEqual(expected);
    }
  });

  test("should produce byte-identical output when called twice with identical input", () => {
    const buildInput = (): readonly TimelineEvent[] => [
      ...ascendingFixture(FIXTURE_BASE),
      ...tiedFixture(FIXTURE_BASE),
    ];

    const first = serialiseTimeline(orderTimeline(buildInput()));
    const second = serialiseTimeline(orderTimeline(buildInput()));

    expect(second).toBe(first);

    expect(JSON.parse(first)).toHaveLength(6);

    const shared = buildInput();
    expect(serialiseTimeline(orderTimeline(shared))).toBe(first);
    expect(serialiseTimeline(orderTimeline(shared))).toBe(first);
  });

  test("should not mutate the array it was given", () => {
    const input = [...ascendingFixture(FIXTURE_BASE), ...tiedFixture(FIXTURE_BASE)];
    const idsBefore = idsOf(input);
    const serialisedBefore = serialiseTimeline(input);

    orderTimeline(input);

    expect(idsOf(input)).toEqual(idsBefore);
    expect(serialiseTimeline(input)).toBe(serialisedBefore);
  });
});
