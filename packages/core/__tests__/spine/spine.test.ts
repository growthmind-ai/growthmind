import { describe, expect, test } from "bun:test";

import { buildStepSpine, placeOnSpine } from "../../src/spine/spine";
import type { StepSpine } from "../../src/spine/types";
import { SPINE_MIN_REACH_RATIO_PERCENT, STEP_SPINE_VERSION } from "../../src/spine/types";
import { NORMALISATION_VERSION, pathsOf, sessionOf } from "./fixtures";

const ORIGIN = "/pricing";
const CHECKOUT = "/checkout";
const DONE = "/done";

const NO_FLOOR = { minReachRatioPercent: 0 };

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

  test("a fractional median decides the order, not just the integer offsets it came from", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN, "/a", "/b"]), sessionOf("s2", [ORIGIN, "/z", "/a", "/b"])],
      ORIGIN,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN, "/z", "/a", "/b"]);
  });

  test("steps at one offset are listed more-reached first, but share a rank rather than being ordered", () => {
    const spine = buildStepSpine(
      [
        sessionOf("s1", [ORIGIN, "/rare"]),
        sessionOf("s2", [ORIGIN, "/common"]),
        sessionOf("s3", [ORIGIN, "/common"]),
      ],
      ORIGIN,
      NO_FLOOR,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN, "/common", "/rare"]);
    expect(spine.steps.map((step) => step.index)).toEqual([0, 1, 1]);
  });

  test("a tie on offset and reach lists by path for stability, and still shares one rank", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN, "/b"]), sessionOf("s2", [ORIGIN, "/a"])],
      ORIGIN,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN, "/a", "/b"]);
    expect(spine.steps.map((step) => step.index)).toEqual([0, 1, 1]);
  });

  test("sessionsReaching counts sessions, not visits, so one session revisiting counts once", () => {
    const spine = buildStepSpine([sessionOf("s1", [ORIGIN, CHECKOUT, ORIGIN, CHECKOUT])], ORIGIN);

    expect(spine.steps[1]).toEqual({ path: CHECKOUT, index: 1, sessionsReaching: 1 });
  });

  test("one session id appearing twice in the corpus counts once, never inflating reach", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN, CHECKOUT]), sessionOf("s1", [ORIGIN, CHECKOUT])],
      ORIGIN,
    );

    expect(spine.steps[0].sessionsReaching).toBe(1);
  });

  test("steps before the origin are not on the spine, because the spine starts where it says", () => {
    const spine = buildStepSpine([sessionOf("s1", ["/home", ORIGIN, CHECKOUT])], ORIGIN);

    expect(pathsOf(spine)).toEqual([ORIGIN, CHECKOUT]);
  });
});

describe("buildStepSpine — the spine is the dominant path, not every branch", () => {
  test("a side branch below the reach floor is excluded, so it cannot outrank the main path", () => {
    const branching = [
      sessionOf("w1", [ORIGIN, "/plan", CHECKOUT]),
      sessionOf("w2", [ORIGIN, "/plan", CHECKOUT]),
      sessionOf("w3", [ORIGIN, "/plan", CHECKOUT]),
      sessionOf("bounced", [ORIGIN, "/faq"]),
    ];

    const spine = buildStepSpine(branching, ORIGIN);

    expect(pathsOf(spine)).toEqual([ORIGIN, "/plan", CHECKOUT]);
  });

  test("a session that bounced to a side branch never reads as further along than one that advanced", () => {
    const branching = [
      sessionOf("w1", [ORIGIN, "/plan", CHECKOUT]),
      sessionOf("w2", [ORIGIN, "/plan", CHECKOUT]),
      sessionOf("w3", [ORIGIN, "/plan", CHECKOUT]),
      sessionOf("bounced", [ORIGIN, "/faq"]),
    ];

    const spine = buildStepSpine(branching, ORIGIN);
    const [bounced] = placeOnSpine(spine, [sessionOf("bounced", [ORIGIN, "/faq"])]);
    const [advanced] = placeOnSpine(spine, [sessionOf("advanced", [ORIGIN, "/plan"])]);

    expect(bounced.deepestVisitedIndex).toBe(0);
    expect(advanced.deepestVisitedIndex).toBe(1);
  });

  test("a miss against the floor drops the step, never invents one the cohort mostly never saw", () => {
    const spine = buildStepSpine(
      [sessionOf("s1", [ORIGIN, "/rare"]), sessionOf("s2", [ORIGIN]), sessionOf("s3", [ORIGIN])],
      ORIGIN,
    );

    expect(pathsOf(spine)).toEqual([ORIGIN]);
  });

  test("the floor the spine was built at is recorded on it, so a reader is not left guessing", () => {
    expect(buildStepSpine([sessionOf("s1", [ORIGIN])], ORIGIN).minReachRatioPercent).toBe(
      SPINE_MIN_REACH_RATIO_PERCENT,
    );
    expect(buildStepSpine([sessionOf("s1", [ORIGIN])], ORIGIN, NO_FLOOR).minReachRatioPercent).toBe(
      0,
    );
  });
});

describe("buildStepSpine — mutually exclusive branches are siblings, not a sequence (B-051)", () => {
  function evenSplit() {
    return [
      sessionOf("a1", [ORIGIN, "/annual", CHECKOUT]),
      sessionOf("a2", [ORIGIN, "/annual", CHECKOUT]),
      sessionOf("m1", [ORIGIN, "/monthly", CHECKOUT]),
      sessionOf("m2", [ORIGIN, "/monthly", CHECKOUT]),
    ];
  }

  test("two sessions one step down alternative branches rank equally, never by alphabet", () => {
    const spine = buildStepSpine(evenSplit(), ORIGIN);

    const [annual] = placeOnSpine(spine, [sessionOf("d1", [ORIGIN, "/annual"])]);
    const [monthly] = placeOnSpine(spine, [sessionOf("d2", [ORIGIN, "/monthly"])]);

    expect(annual.deepestVisitedIndex).toBe(monthly.deepestVisitedIndex);
  });

  test("the step after two alternatives ranks once, not once per branch", () => {
    const spine = buildStepSpine(evenSplit(), ORIGIN);

    expect(spine.steps.map((step) => step.index)).toEqual([0, 1, 1, 2]);
  });

  test("a spine holding siblings says so, so a consumer can decline to call it a divergence", () => {
    expect(buildStepSpine(evenSplit(), ORIGIN).branching).toBe(true);
  });

  test("a spine with one step per rank reports no branching, so the signal is not always on", () => {
    const linear = buildStepSpine(
      [sessionOf("s1", [ORIGIN, CHECKOUT, DONE]), sessionOf("s2", [ORIGIN, CHECKOUT, DONE])],
      ORIGIN,
    );

    expect(linear.branching).toBe(false);
    expect(linear.steps.map((step) => step.index)).toEqual([0, 1, 2]);
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

  test("a surface rename forks the identity — the ancestry edge that would map it is owed by B-031", () => {
    const before = buildStepSpine([sessionOf("s1", [ORIGIN, "/checkout"])], "/checkout");
    const after = buildStepSpine([sessionOf("s1", [ORIGIN, "/pay"])], "/pay");

    expect(after.identity).not.toEqual(before.identity);
  });

  test("a normalisation version bump forks the identity for one unchanged surface", () => {
    const v1 = buildStepSpine([sessionOf("s1", [ORIGIN], { normalisationVersion: 1 })], ORIGIN);
    const v2 = buildStepSpine([sessionOf("s1", [ORIGIN], { normalisationVersion: 2 })], ORIGIN);

    expect(v1.identity.surface).toBe(v2.identity.surface);
    expect(v1.identity).not.toEqual(v2.identity);
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

  test("deepestVisitedIndex is the furthest step the session touched", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [ORIGIN, CHECKOUT])]);

    expect(placement.deepestVisitedIndex).toBe(1);
    expect(placement.visitedIndexes).toEqual([0, 1]);
  });

  test("a session that never entered the origin is unplaced (null), never placed at step 0", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", ["/elsewhere"])]);

    expect(placement.deepestVisitedIndex).toBeNull();
    expect(placement.visitedIndexes).toEqual([]);
    expect(placement.originVisits).toBe(0);
  });

  test("a path absent from the spine is ignored, never assigned an invented index", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [ORIGIN, "/unknown"])]);

    expect(placement.deepestVisitedIndex).toBe(0);
    expect(placement.visitedIndexes).toEqual([0]);
  });

  test("steps visited before the origin do not count, because placement starts at the origin", () => {
    const [placement] = placeOnSpine(spine(), [sessionOf("s1", [DONE, ORIGIN])]);

    expect(placement.deepestVisitedIndex).toBe(0);
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
    const [placement] = placeOnSpine(built, [sessionOf("s1", [ORIGIN])]);

    expect(built.steps).toHaveLength(3);
    expect(placement.visitedIndexes).toEqual([0]);
    expect(placement.deepestVisitedIndex).toBe(0);
  });

  test("a spine whose steps omit its own origin yields null, never a poison -Infinity", () => {
    const originless: StepSpine = {
      identity: {
        surface: ORIGIN,
        surfaceNormalisationVersion: NORMALISATION_VERSION,
        spineVersion: STEP_SPINE_VERSION,
      },
      minReachRatioPercent: SPINE_MIN_REACH_RATIO_PERCENT,
      branching: false,
      steps: [{ path: CHECKOUT, index: 0, sessionsReaching: 1 }],
    };

    const [placement] = placeOnSpine(originless, [sessionOf("s1", [ORIGIN])]);

    expect(placement.deepestVisitedIndex).toBeNull();
    expect(placement.originVisits).toBe(1);
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

    expect(succeeded.map((placement) => placement.deepestVisitedIndex)).toEqual([2, 2]);
    expect(failed.map((placement) => placement.deepestVisitedIndex)).toEqual([1, 1]);
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
