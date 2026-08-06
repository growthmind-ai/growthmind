import { describe, expect, test } from "bun:test";

import { applyCitationGate } from "../../src/cause/citation-gate";

function claim(
  statement: string,
  citesBeats: readonly number[],
): { readonly statement: string; readonly citesBeats: readonly number[] } {
  return { statement, citesBeats };
}

const BEAT_COUNT = 3;

describe("applyCitationGate — drop conditions", () => {
  test("should drop a claim citing zero beats", () => {
    const result = applyCitationGate([claim("Nothing backs this up.", [])], BEAT_COUNT);

    expect(result.survivors).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });

  test("should drop a claim citing a beat index outside the supplied evidence", () => {
    const result = applyCitationGate(
      [claim("This cites a beat that does not exist.", [BEAT_COUNT])],
      BEAT_COUNT,
    );

    expect(result.survivors).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });
});

describe("applyCitationGate — survival", () => {
  test("should keep a claim whose every cited index is in range", () => {
    const validClaim = claim("The field was left empty before the person navigated away.", [1]);

    const result = applyCitationGate([validClaim], BEAT_COUNT);

    expect(result.droppedCount).toBe(0);
    expect(result.survivors).toEqual([validClaim]);
  });
});

describe("applyCitationGate — a partially-cited claim is dropped whole, never trimmed", () => {
  test("should never trim an offending citation and republish the rest of the claim", () => {
    const mixedClaim = claim("Part of this claim rests on evidence outside range.", [
      0,
      BEAT_COUNT,
    ]);

    const result = applyCitationGate([mixedClaim], BEAT_COUNT);

    // never kept with the out-of-range index quietly removed
    expect(result.survivors).toHaveLength(0);
    expect(result.droppedCount).toBe(1);
  });
});

describe("applyCitationGate — one-pass counting", () => {
  test("should count drops independently of survivors in one pass", () => {
    const survivingClaim = claim("This one is well cited.", [0]);

    const result = applyCitationGate(
      [
        claim("This one cites nothing.", []),
        survivingClaim,
        claim("This one cites out of range.", [BEAT_COUNT + 1]),
      ],
      BEAT_COUNT,
    );

    expect(result.survivors).toEqual([survivingClaim]);
    expect(result.droppedCount).toBe(2);
  });
});
