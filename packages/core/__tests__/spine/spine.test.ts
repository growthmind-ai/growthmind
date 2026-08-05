import { describe, expect, test } from "bun:test";

import { buildStepSpine, placeOnSpine } from "../../src/spine/spine";
import { STEP_SPINE_VERSION } from "../../src/spine/types";
import { NORMALISATION_VERSION, pathsOf, sessionOf } from "./fixtures";

const ORIGIN = "/pricing";
const CHECKOUT = "/checkout";
const DONE = "/done";

describe("buildStepSpine — the canonical order", () => {
  test("the origin is always step 0, whatever the sessions did after it", () => {
    const spine = buildStepSpine([sessionOf("s1", [ORIGIN, CHECKOUT])], ORIGIN);

    expect(spine.steps[0]).toEqual({ path: ORIGIN, index: 0, sessionsReaching: 1 });
  });

  test("steps are ordered by their typical first offset from the origin", () => {
    const spine = buildStepSpine(
      [
        sessionOf("s1", [ORIGIN, CHECKOUT, DONE]),
        sessionOf("s2", [ORIGIN, CHECKOUT, DONE]),
        sessionOf("s3", [ORIGIN, DONE]),
      ],
      ORIGIN,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN, CHECKOUT, DONE]);
    expect(spine.steps.map((step) => step.index)).toEqual([0, 1, 2]);
  });

  test("an offset tie breaks toward the step more sessions reached, never toward insertion order", () => {
    const spine = buildStepSpine(
      [
        sessionOf("s1", [ORIGIN, "/rare"]),
        sessionOf("s2", [ORIGIN, "/common"]),
        sessionOf("s3", [ORIGIN, "/common"]),
      ],
      ORIGIN,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN, "/common", "/rare"]);
  });

  test("a tie on offset and reach breaks by path, so the order is stable across runs", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN, "/b"]), sessionOf("s2", [ORIGIN, "/a"])],
      ORIGIN,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN, "/a", "/b"]);
  });

  test("sessionsReaching counts sessions, not visits, so one session revisiting counts once", () => {
    const spine = buildStepSpine([sessionOf("s1", [ORIGIN, CHECKOUT, ORIGIN, CHECKOUT])], ORIGIN);

    expect(spine.steps[1]).toEqual({ path: CHECKOUT, index: 1, sessionsReaching: 1 });
  });

  test("steps before the origin are not on the spine, because the spine starts where it says", () => {
    const spine = buildStepSpine([sessionOf("s1", ["/home", ORIGIN, CHECKOUT])], ORIGIN);

    expect(pathsOf(spine)).toEqual([ORIGIN, CHECKOUT]);
  });
});

describe("buildStepSpine — identity (D12)", () => {
  test("identity carries the surface and its normalisation version, not the path alone", () => {
    const spine = buildStepSpine([sessionOf("s1", [ORIGIN, CHECKOUT])], ORIGIN);

    expect(spine.identity).toEqual({
      surface: ORIGIN,
      surfaceNormalisationVersion: NORMALISATION_VERSION,
      spineVersion: STEP_SPINE_VERSION,
    });
  });

  test("a disagreeing normalisation version yields null, never a guessed version in the identity", () => {
    const spine = buildStepSpine(
      [
        sessionOf("s1", [ORIGIN], { normalisationVersion: 1 }),
        sessionOf("s2", [ORIGIN], { normalisationVersion: 2 }),
      ],
      ORIGIN,
    );

    expect(spine.identity.surfaceNormalisationVersion).toBeNull();
  });

  test("the spine version is stamped so a vocabulary change cannot be read as the old order", () => {
    const spine = buildStepSpine([sessionOf("s1", [ORIGIN])], ORIGIN);

    expect(spine.identity.spineVersion).toBe(STEP_SPINE_VERSION);
  });
});

describe("buildStepSpine — boundaries degrade, they do not throw (D5)", () => {
  test("a surface nobody visited yields a length-one spine reaching zero sessions, not a throw", () => {
    const spine = buildStepSpine([sessionOf("s1", ["/elsewhere"])], ORIGIN);

    expect(spine.steps).toEqual([{ path: ORIGIN, index: 0, sessionsReaching: 0 }]);
  });

  test("no sessions at all yields a length-one spine, not a throw", () => {
    const spine = buildStepSpine([], ORIGIN);

    expect(spine.steps).toHaveLength(1);
    expect(spine.steps[0].sessionsReaching).toBe(0);
  });

  test("sessions that only ever hit the origin yield a spine of length one", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN]), sessionOf("s2", [ORIGIN, ORIGIN])],
      ORIGIN,
    );

    expect(spine.steps).toEqual([{ path: ORIGIN, index: 0, sessionsReaching: 2 }]);
  });

  test("a two-event session produces a two-step spine rather than degenerating", () => {
    const spine = buildStepSpine([sessionOf("s1", [ORIGIN, CHECKOUT])], ORIGIN);

    expect(pathsOf(spine)).toEqual([ORIGIN, CHECKOUT]);
  });

  test("a surface nobody visited twice still builds, with every session reaching it once", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN, CHECKOUT]), sessionOf("s2", [ORIGIN, CHECKOUT])],
      ORIGIN,
    );

    expect(spine.steps[0].sessionsReaching).toBe(2);
    expect(spine.steps[1].sessionsReaching).toBe(2);
  });
});

describe("placeOnSpine", () => {
  function spine() {
    return buildStepSpine(
      [sessionOf("seed1", [ORIGIN, CHECKOUT, DONE]), sessionOf("seed2", [ORIGIN, CHECKOUT, DONE])],
      ORIGIN,
    );
  }

  test("reachedIndex is the furthest step the session touched", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [ORIGIN, CHECKOUT])]);

    expect(placement.reachedIndex).toBe(1);
    expect(placement.visitedIndexes).toEqual([0, 1]);
  });

  test("a session that never entered the origin is unplaced (null), never placed at step 0", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", ["/elsewhere"])]);

    expect(placement.reachedIndex).toBeNull();
    expect(placement.visitedIndexes).toEqual([]);
    expect(placement.originVisits).toBe(0);
  });

  test("a path absent from the spine is ignored, never assigned an invented index", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [ORIGIN, "/unknown"])]);

    expect(placement.reachedIndex).toBe(0);
    expect(placement.visitedIndexes).toEqual([0]);
  });

  test("steps visited before the origin do not count, because placement starts at the origin", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [DONE, ORIGIN])]);

    expect(placement.reachedIndex).toBe(0);
    expect(placement.visitedIndexes).toEqual([0]);
  });

  test("originVisits counts collapsed revisits, so a reload is not a second attempt", () => {
    const [placement] = placeOnSpine(spine(), [
      sessionOf("s1", [ORIGIN, ORIGIN, CHECKOUT, ORIGIN]),
    ]);

    expect(placement.originVisits).toBe(2);
  });

  test("visitedIndexes is sorted and deduped, so a revisit does not appear twice", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [ORIGIN, DONE, CHECKOUT, DONE])]);

    expect(placement.visitedIndexes).toEqual([0, 1, 2]);
  });

  test("no sessions degrades to no placements rather than throwing", () => {
    expect(placeOnSpine(spine(), [])).toEqual([]);
  });

  test("a step reached by zero sessions in this cohort stays on the spine, unreached (D5)", () => {
    const built = spine();
    const placements = placeOnSpine(built, [sessionOf("s1", [ORIGIN])]);

    expect(built.steps).toHaveLength(3);
    expect(placements[0].visitedIndexes).toEqual([0]);
    expect(placements.every((placement) => placement.reachedIndex !== 2)).toBe(true);
  });
});

describe("placeOnSpine — the outcome's goal: two cohorts, one spine", () => {
  test("two callers place two different cohorts on the same spine for one surface", () => {
    const all = [
      sessionOf("won1", [ORIGIN, CHECKOUT, DONE]),
      sessionOf("won2", [ORIGIN, CHECKOUT, DONE]),
      sessionOf("lost1", [ORIGIN, CHECKOUT]),
      sessionOf("lost2", [ORIGIN, CHECKOUT]),
    ];

    const shared = buildStepSpine(all, ORIGIN);

    const succeeded = placeOnSpine(shared, [all[0], all[1]]);
    const failed = placeOnSpine(shared, [all[2], all[3]]);

    expect(pathsOf(shared)).toEqual([ORIGIN, CHECKOUT, DONE]);

    expect(succeeded.map((placement) => placement.reachedIndex)).toEqual([2, 2]);
    expect(failed.map((placement) => placement.reachedIndex)).toEqual([1, 1]);
  });

  test("placing a cohort does not mutate the spine, so the second caller reads the same steps", () => {
    const all = [sessionOf("won1", [ORIGIN, CHECKOUT, DONE]), sessionOf("lost1", [ORIGIN])];
    const shared = buildStepSpine(all, ORIGIN);
    const before = structuredClone(shared);

    placeOnSpine(shared, [all[0]]);
    placeOnSpine(shared, [all[1]]);

    expect(shared).toEqual(before);
  });
});
