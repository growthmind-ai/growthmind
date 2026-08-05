import { describe, expect, test } from "bun:test";

import type { SessionTimeline } from "../../src/detect/types";
import { sessionWalk, surfaceNormalisationVersionOf, transitionsOf } from "../../src/spine/walk";
import { NORMALISATION_VERSION, STARTED_AT, sessionOf } from "./fixtures";

const ORIGIN = "/pricing";
const DESTINATION = "/checkout";

describe("sessionWalk", () => {
  test("collapses consecutive repeats, so a reload never reads as a second step", () => {
    const session = sessionOf("s1", [ORIGIN, ORIGIN, ORIGIN, DESTINATION]);

    expect(sessionWalk(session)).toEqual([ORIGIN, DESTINATION]);
  });

  test("a non-consecutive return is kept, because leaving and coming back is a real revisit", () => {
    const session = sessionOf("s1", [ORIGIN, DESTINATION, ORIGIN]);

    expect(sessionWalk(session)).toEqual([ORIGIN, DESTINATION, ORIGIN]);
  });

  test("an event with no url path is skipped without breaking the walk around it", () => {
    const session = sessionOf("s1", [ORIGIN, null, DESTINATION]);

    expect(sessionWalk(session)).toEqual([ORIGIN, DESTINATION]);
  });

  test("a null between two identical paths still collapses, never splitting one visit in two", () => {
    const session = sessionOf("s1", [ORIGIN, null, ORIGIN]);

    expect(sessionWalk(session)).toEqual([ORIGIN]);
  });

  test("orders by instant then source id, not by arrival order in the array", () => {
    const unordered: SessionTimeline = {
      sessionId: "s1",
      startedAt: STARTED_AT,
      exclusionReason: "none",
      entryUrlPath: ORIGIN,
      events: [
        {
          sourceEventId: "b",
          name: "$pageview",
          occurredAt: new Date(STARTED_AT.getTime() + 1_000),
          urlPath: DESTINATION,
          urlPathNormalisationVersion: NORMALISATION_VERSION,
        },
        {
          sourceEventId: "a",
          name: "$pageview",
          occurredAt: STARTED_AT,
          urlPath: ORIGIN,
          urlPathNormalisationVersion: NORMALISATION_VERSION,
        },
      ],
    };

    expect(sessionWalk(unordered)).toEqual([ORIGIN, DESTINATION]);
  });

  test("a session with no events degrades to an empty walk rather than throwing", () => {
    expect(sessionWalk(sessionOf("s1", []))).toEqual([]);
  });

  test("a session whose every event lacks a url path degrades to an empty walk", () => {
    expect(sessionWalk(sessionOf("s1", [null, null]))).toEqual([]);
  });
});

describe("transitionsOf", () => {
  test("records the edge between consecutive steps in a walk", () => {
    const transitions = transitionsOf([[ORIGIN, DESTINATION]]);

    expect([...(transitions.get(ORIGIN) ?? [])]).toEqual([DESTINATION]);
  });

  test("merges destinations across walks sharing one origin", () => {
    const transitions = transitionsOf([
      [ORIGIN, DESTINATION],
      [ORIGIN, "/help"],
    ]);

    expect([...(transitions.get(ORIGIN) ?? [])].toSorted()).toEqual(["/checkout", "/help"]);
  });

  test("a walk of one step contributes no edge, never an edge to itself", () => {
    expect(transitionsOf([[ORIGIN]]).size).toBe(0);
  });

  test("no walks degrades to an empty map rather than throwing", () => {
    expect(transitionsOf([]).size).toBe(0);
  });
});

describe("surfaceNormalisationVersionOf", () => {
  test("returns the version when every event on the surface agrees", () => {
    const sessions = [sessionOf("s1", [ORIGIN]), sessionOf("s2", [ORIGIN])];

    expect(surfaceNormalisationVersionOf(sessions, ORIGIN)).toBe(NORMALISATION_VERSION);
  });

  test("disagreeing versions yield null, never one of the two guessed as canonical", () => {
    const sessions = [
      sessionOf("s1", [ORIGIN], { normalisationVersion: 1 }),
      sessionOf("s2", [ORIGIN], { normalisationVersion: 2 }),
    ];

    expect(surfaceNormalisationVersionOf(sessions, ORIGIN)).toBeNull();
  });

  test("a surface that appears in no session yields null rather than throwing", () => {
    expect(surfaceNormalisationVersionOf([sessionOf("s1", [DESTINATION])], ORIGIN)).toBeNull();
  });

  test("reads only the named surface, so a sibling's version cannot leak in", () => {
    const sessions = [
      sessionOf("s1", [ORIGIN], { normalisationVersion: 1 }),
      sessionOf("s2", [DESTINATION], { normalisationVersion: 2 }),
    ];

    expect(surfaceNormalisationVersionOf(sessions, ORIGIN)).toBe(1);
  });
});
