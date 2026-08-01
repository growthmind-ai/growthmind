// THE STAGE REDUCER — THE D4 PROOF (AD-5). ADD §9, 13 rows.
//
// This is the one screen the MVP exists for: a founder breaks something in
// their own product and watches us narrate it back with evidence. Every failure
// mode of this reducer is therefore a failure of the product's whole promise,
// and one of them is worse than all the others — rendering "nothing was found"
// over a finding that is ALREADY WRITTEN.
//
// ###########################################################################
// # THE AD-5 TRAP. IT LOOKS CORRECT WHEN IT IS WRONG.
// #
// #   `completed + produced_findings + finding === null` FALLS THROUGH TO
// #   `leg2`, **NOT** `ended`.
// #
// # A run can reach `completed` with `outcome === "produced_findings"`
// # MICROSECONDS before the finding row is readable by the next poll. Falling
// # to `ended` there renders "nothing was found" over a finding that exists.
// # The state is transient by construction; the next poll resolves it into
// # branch 1.
// #
// # THE STORYBOARD'S DEMO CODE HAS THIS WRONG. Its reducer
// # (.ai/ux/onboarding-five-steps.interaction.html:515-521) checks `armedAt`
// # FIRST, before the finding, and has no out-of-order guard at all. An
// # implementer reading the playable prototype WILL find the wrong order. The
// # ADD's order is the contract; the prototype is stale by its own spec's
// # header rule.
// #
// # BRANCH ORDER, LOAD-BEARING (AD-5, lines 211-217):
// #   1. finding !== null                            -> "finding"
// #   2. armedAt === null                            -> "unarmed"
// #   3. terminal AND cannot still produce a finding -> "ended"
// #        precisely: runStatus === "failed"                             -> ended("failed")
// #        or runStatus === "completed" && runOutcome !== "produced_findings"
// #                                                                      -> ended(runOutcome)
// #   4. readingAt !== null                          -> "leg2"
// #   5. otherwise                                   -> "leg1"
// #
// # Order 1-before-2 is what buys row 4 ("a finding persisted before the user
// # landed renders immediately on first paint") FOR FREE: branch 1 never
// # consults `armedAt`. That row, and row 3, are the two that catch the
// # storyboard — and the control block at the bottom of this file PROVES they
// # catch it, by running the storyboard's own order through both fixtures.
// ###########################################################################
//
// NOTE FOR THE WAVE THAT WRITES stage.ts — AN ADD/UX DIVERGENCE, FLAGGED:
// the ADD's branch order puts `unarmed` at 2 and `ended` at 3; the UX spec §4
// (line 373-374) puts them the other way round. They differ on exactly one
// input class — `armedAt === null` WITH a terminal run status, which is real
// (the hourly cron opens runs for reasons unrelated to the user's trigger).
// The ADD's order renders `unarmed` there, which is right: a surface the user
// never armed must not report an ending. The UX order would render `ended`.
// THE ADD WINS per the sprint's stated authority order, and that is what is
// encoded here.

import { describe, expect, test } from "bun:test";

import {
  ANALYSIS_OUTCOME_MESSAGES,
  ANALYSIS_RUN_STATUS_MESSAGES,
} from "../../src/summary/messages";
import type {
  OnboardingFinding,
  ReduceStage,
  RenderedStageState,
  StagePersistedFacts,
} from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 (task 1c.1) creates this. Until then every row below is red on
 *  an ABSENT BEHAVIOUR, named as such — see `module-under-construction.ts`. */
const loadReduceStage = (): Promise<ReduceStage> =>
  loadUnderConstruction<ReduceStage>({
    modulePath: "../../src/onboarding/stage",
    exportName: "reduceStage",
    ownedBy: "ADD Wave 1, task 1c.1",
  });

// --- fixtures --------------------------------------------------------------

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const ARMED_MS = ARMED_AT.getTime();

/** Whole seconds throughout, so no row is accidentally a claim about how the
 *  implementation rounds a partial second. */
const secondsAfterArming = (n: number): number => ARMED_MS + n * 1000;

const FINDING: OnboardingFinding = {
  finalClass: "something_is_not_working",
  headline: "Saving your workspace settings is not working.",
  context: ["Three people hit this in the last hour."],
  counts: [{ numerator: 3, denominator: 3, unit: "sessions" }],
  surface: "/settings",
  confidenceBasis: "above_floor",
  windowStart: new Date("2026-08-01T09:55:00.000Z"),
  windowEnd: new Date("2026-08-01T10:07:00.000Z"),
  summarySource: "model_rendered",
};

/** Nothing has happened yet: the surface was never armed. */
const NOTHING: StagePersistedFacts = {
  armedAt: null,
  retrievedAt: null,
  readingAt: null,
  endedAt: null,
  runStatus: null,
  runOutcome: null,
  finding: null,
};

const facts = (overrides: Partial<StagePersistedFacts>): StagePersistedFacts => ({
  ...NOTHING,
  ...overrides,
});

describe("reduceStage — AD-5, the D4 proof", () => {
  // Row 1
  test("completed persisted state with no live signal renders done, not loading", async () => {
    const reduceStage = await loadReduceStage();

    // THE ABSENCE OF A LIVE-SIGNAL PARAMETER IS THE GUARANTEE (AD-5:211). A
    // behavioural assertion alone would let somebody add the parameter back and
    // keep every row green, so the arity is pinned directly. `.length` counts
    // declared parameters before the first default/rest, which is exactly the
    // signature claim being made.
    expect(reduceStage.length).toBe(2);

    const state = reduceStage(
      facts({
        armedAt: ARMED_AT,
        retrievedAt: new Date(secondsAfterArming(26)),
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(37)),
        runStatus: "completed",
        runOutcome: "produced_findings",
        finding: FINDING,
      }),
      // A full day later. There is no live signal to consult and none is
      // passed: this is the hard-reload-after-the-finding case (UX row 23).
      secondsAfterArming(86_400),
    );

    expect(state.kind).toBe("finding");
    expect(state).toMatchObject({ kind: "finding", finding: FINDING });
  });

  // Row 2
  test("no persisted state and no live signal renders the first waiting stage", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(facts({ armedAt: ARMED_AT }), secondsAfterArming(3));

    expect(state.kind).toBe("leg1");
  });

  // Row 3 — THE OUT-OF-ORDER GUARD. One of the two storyboard-killers.
  test("a live signal arriving before the persisted row does not render done", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
      facts({
        armedAt: ARMED_AT,
        retrievedAt: new Date(secondsAfterArming(26)),
        // A run that reached `completed` necessarily STARTED, and AD-6 derives
        // `readingAt` from `min(analysis_runs.started_at)` — so this is
        // non-null by construction, not by fixture convenience.
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(37)),
        runStatus: "completed",
        runOutcome: "produced_findings",
        // ...and the finding row is not readable by this poll YET.
        finding: null,
      }),
      secondsAfterArming(37),
    );

    // Still reading, not finished. Falling to `ended` here would render
    // "nothing was found" over a finding that is already written.
    expect(state.kind).toBe("leg2");
    expect(state.kind).not.toBe("ended");
    expect(state.kind).not.toBe("finding");
  });

  // Row 4 — branch 1 precedes branch 2. The other storyboard-killer.
  test("a finding persisted before the user landed renders immediately on first paint", async () => {
    const reduceStage = await loadReduceStage();

    // `armedAt` is null and the finding exists. Branch 1 NEVER CONSULTS
    // `armedAt`, so this renders the payoff on first paint. The storyboard's
    // order returns `unarmed` here and shows the founder nothing.
    const state = reduceStage(facts({ finding: FINDING }), secondsAfterArming(37));

    expect(state.kind).toBe("finding");

    // A null origin must not leak a NaN into the rendered clock (D5).
    expect(state).toMatchObject({ kind: "finding" });
    if (state.kind === "finding") {
      expect(Number.isFinite(state.elapsedSeconds)).toBe(true);
      expect(state.elapsedSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  // Row 5
  test("an unarmed surface with no finding renders unarmed", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(NOTHING, ARMED_MS);

    expect(state).toEqual({ kind: "unarmed" });
  });

  // Row 6a
  test("readingAt set renders leg2", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
      facts({
        armedAt: ARMED_AT,
        retrievedAt: new Date(secondsAfterArming(26)),
        readingAt: new Date(secondsAfterArming(31)),
        runStatus: "running",
      }),
      secondsAfterArming(33),
    );

    expect(state.kind).toBe("leg2");
  });

  // Row 6b
  test("readingAt null with armedAt set renders leg1", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
      facts({ armedAt: ARMED_AT, retrievedAt: new Date(secondsAfterArming(26)) }),
      secondsAfterArming(28),
    );

    expect(state.kind).toBe("leg1");
  });

  // Row 7
  test("a failed run with no finding renders ended with the failed reason", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
      facts({
        armedAt: ARMED_AT,
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(35)),
        runStatus: "failed",
        runOutcome: null,
        finding: null,
      }),
      secondsAfterArming(40),
    );

    expect(state).toMatchObject({ kind: "ended", reason: "failed" });

    // The reason is a KEY into a shipped message table, never a sentence
    // authored in the reducer (B3 — one home for copy).
    if (state.kind === "ended") {
      expect(ANALYSIS_RUN_STATUS_MESSAGES[state.reason as "failed"]).toBeTruthy();
    }
  });

  // Row 8
  test("a completed run whose outcome is no_candidates_passed_gate renders ended with that reason", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
      facts({
        armedAt: ARMED_AT,
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(35)),
        runStatus: "completed",
        runOutcome: "no_candidates_passed_gate",
        finding: null,
      }),
      secondsAfterArming(40),
    );

    expect(state).toMatchObject({ kind: "ended", reason: "no_candidates_passed_gate" });
  });

  // Row 9 — UX Checklist row 21. THE THREE ENDED REASONS ARE NEVER COLLAPSED.
  test("a completed run whose outcome is no_sessions_to_analyse renders ended with a different reason from the row above", async () => {
    const reduceStage = await loadReduceStage();

    const quiet = reduceStage(
      facts({
        armedAt: ARMED_AT,
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(35)),
        runStatus: "completed",
        runOutcome: "no_sessions_to_analyse",
        finding: null,
      }),
      secondsAfterArming(40),
    );

    const nothingSolid = reduceStage(
      facts({
        armedAt: ARMED_AT,
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(35)),
        runStatus: "completed",
        runOutcome: "no_candidates_passed_gate",
        finding: null,
      }),
      secondsAfterArming(40),
    );

    const failed = reduceStage(
      facts({
        armedAt: ARMED_AT,
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(35)),
        runStatus: "failed",
        runOutcome: null,
        finding: null,
      }),
      secondsAfterArming(40),
    );

    expect(quiet).toMatchObject({ kind: "ended", reason: "no_sessions_to_analyse" });

    // "We have not looked yet" and "we looked and your product was quiet" are
    // DIFFERENT ANSWERS TO THE SAME ZERO, and a failed run is a third thing
    // again. All three reasons distinct, and all three shipped sentences
    // distinct — collapsing any pair tells a founder something untrue about
    // their product.
    const reasons = [quiet, nothingSolid, failed].map((s) =>
      s.kind === "ended" ? s.reason : "NOT_ENDED",
    );
    expect(new Set(reasons).size).toBe(3);

    expect(ANALYSIS_OUTCOME_MESSAGES.no_sessions_to_analyse).not.toBe(
      ANALYSIS_OUTCOME_MESSAGES.no_candidates_passed_gate,
    );
    expect(ANALYSIS_RUN_STATUS_MESSAGES.failed).not.toBe(
      ANALYSIS_OUTCOME_MESSAGES.no_candidates_passed_gate,
    );
  });

  // Row 10
  test("elapsed is now minus armedAt, recomputed, for every non-unarmed state", async () => {
    const reduceStage = await loadReduceStage();

    const waiting = facts({ armedAt: ARMED_AT });
    const reading = facts({
      armedAt: ARMED_AT,
      retrievedAt: new Date(secondsAfterArming(26)),
      readingAt: new Date(secondsAfterArming(31)),
      runStatus: "running",
    });

    // The SAME facts under TWO clocks. Elapsed is recomputed from the persisted
    // origin, never an incremented client counter — so a backgrounded tab, a
    // slow frame and a hard reload all come back with the right number.
    const early = reduceStage(waiting, secondsAfterArming(5));
    const later = reduceStage(waiting, secondsAfterArming(90));

    expect(early).toMatchObject({ kind: "leg1", elapsedSeconds: 5 });
    expect(later).toMatchObject({ kind: "leg1", elapsedSeconds: 90 });

    expect(reduceStage(reading, secondsAfterArming(33))).toMatchObject({
      kind: "leg2",
      elapsedSeconds: 33,
    });
    expect(reduceStage(reading, secondsAfterArming(400))).toMatchObject({
      kind: "leg2",
      elapsedSeconds: 400,
    });
  });

  // Row 11
  test("elapsed is frozen at endedAt once a terminal state is reached", async () => {
    const reduceStage = await loadReduceStage();

    const ended = facts({
      armedAt: ARMED_AT,
      readingAt: new Date(secondsAfterArming(31)),
      endedAt: new Date(secondsAfterArming(37)),
      runStatus: "completed",
      runOutcome: "no_candidates_passed_gate",
      finding: null,
    });

    const found = facts({
      armedAt: ARMED_AT,
      readingAt: new Date(secondsAfterArming(31)),
      endedAt: new Date(secondsAfterArming(37)),
      runStatus: "completed",
      runOutcome: "produced_findings",
      finding: FINDING,
    });

    // The wait TERMINATES. Advancing the clock past `endedAt` must not advance
    // the readout — a frozen elapsed is what makes the ending an ending rather
    // than a counter that never stops (UX row 21: the breathing dot unmounts).
    expect(reduceStage(ended, secondsAfterArming(37))).toMatchObject({ elapsedSeconds: 37 });
    expect(reduceStage(ended, secondsAfterArming(9_000))).toMatchObject({ elapsedSeconds: 37 });

    expect(reduceStage(found, secondsAfterArming(9_000))).toMatchObject({
      kind: "finding",
      elapsedSeconds: 37,
    });
  });

  // Row 12 — AD-6's designed out-of-order leg case.
  test("readingAt without retrievedAt is a designed state, not a crash", async () => {
    const reduceStage = await loadReduceStage();

    // `readingAt` can PRECEDE `retrievedAt`: the hourly cron opens a run for
    // reasons unrelated to the user's trigger, so the two legs are written by
    // two different processes into two different tables and neither orders the
    // other. The log renders whichever lines are non-null. This is a designed
    // render, not an accident.
    const state = reduceStage(
      facts({
        armedAt: ARMED_AT,
        retrievedAt: null,
        readingAt: new Date(secondsAfterArming(12)),
        runStatus: "running",
      }),
      secondsAfterArming(20),
    );

    expect(state).toMatchObject({ kind: "leg2", elapsedSeconds: 20 });
  });

  // Row 13
  test("reduceStage is pure — the same facts and clock always yield the same state", async () => {
    const reduceStage = await loadReduceStage();

    const input = facts({
      armedAt: ARMED_AT,
      retrievedAt: new Date(secondsAfterArming(26)),
      readingAt: new Date(secondsAfterArming(31)),
      runStatus: "running",
    });
    const at = secondsAfterArming(33);

    const first = reduceStage(input, at);
    const second = reduceStage(input, at);

    expect(second).toEqual(first);

    // No ambient clock: real wall-clock time passes between these two calls and
    // the answer does not move, because the only clock is the one passed in.
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* burn a few real milliseconds */
    }
    expect(reduceStage(input, at)).toEqual(first);

    // And the input is not mutated on the way through.
    expect(input.readingAt).toEqual(new Date(secondsAfterArming(31)));
  });
});

// ---------------------------------------------------------------------------
// PLANTED-OFFENDER CONTROL — NOT CONTRACT ROWS, AND GREEN BY DESIGN.
//
// The ADD's standing rule 1 (§9) requires every scanner to ship a planted
// offender beside it, "asserted before any claim about real source", because a
// scanner that matched nothing would report green forever. The same hazard
// applies to a branch-order oracle: rows 3 and 4 above are the ONLY thing
// standing between this product and its worst render, and on the Wave 0 tree
// they cannot demonstrate that their fixtures actually discriminate — there is
// no implementation for them to run against yet.
//
// So the storyboard's own order is transcribed here and run through both
// fixtures. These two tests PASS on this tree and are expected to: they are
// evidence that rows 3 and 4 bite, not claims about `reduceStage`. They are
// excluded from the wave's 37-row count.
// ---------------------------------------------------------------------------

/**
 * The storyboard's demo reducer, transcribed onto `StagePersistedFacts`.
 *
 * `.ai/ux/onboarding-five-steps.interaction.html:515-521`, verbatim:
 *
 *     function reduceStage(p, elapsed){
 *       if (p.armedAt === null)      return { kind:"unarmed" };
 *       if (p.outcome === "finding") return { kind:"finding", ... };
 *       if (p.outcome)               return { kind:"ended", ... };
 *       if (p.readingAt !== null)    return { kind:"leg2", ... };
 *       return { kind:"leg1", ... };
 *     }
 *
 * TWO DEFECTS, both preserved here. (1) `armedAt` is tested FIRST, ahead of the
 * finding. (2) There is no out-of-order guard: the demo collapses "a finding
 * exists" and "the run's outcome" into ONE `outcome` field, so on the real
 * split shape a completed `produced_findings` run whose finding row is not yet
 * readable has a truthy outcome and a null finding — and falls straight to
 * `ended`.
 */
const storyboardReduceStage = (p: StagePersistedFacts, nowMs: number): RenderedStageState => {
  const elapsedSeconds = p.armedAt === null ? 0 : Math.round((nowMs - p.armedAt.getTime()) / 1000);

  if (p.armedAt === null) return { kind: "unarmed" };
  if (p.finding !== null) return { kind: "finding", elapsedSeconds, finding: p.finding };
  if (p.runOutcome !== null || p.runStatus === "failed") {
    return { kind: "ended", elapsedSeconds, reason: "no_candidates_passed_gate" };
  }
  if (p.readingAt !== null) return { kind: "leg2", elapsedSeconds };
  return { kind: "leg1", elapsedSeconds };
};

describe("planted-offender control — the storyboard's order, proving rows 3 and 4 bite", () => {
  test("CONTROL: the storyboard's armedAt-first order renders unarmed over a finding that exists", () => {
    // Row 4's exact fixture. The correct reducer returns "finding"; the
    // storyboard returns "unarmed" and the founder sees an empty stage with a
    // finding sitting in the database. Row 4 therefore discriminates.
    const wrong = storyboardReduceStage(facts({ finding: FINDING }), secondsAfterArming(37));

    expect(wrong.kind).toBe("unarmed");
    expect(wrong.kind).not.toBe("finding");
  });

  test("CONTROL: the storyboard's missing out-of-order guard renders ended over a finding already written", () => {
    // Row 3's exact fixture. The correct reducer returns "leg2"; the storyboard
    // returns "ended" — "nothing was found", printed over a finding that is
    // already written. THIS IS THE WORST RENDER ON THIS SURFACE, and row 3 is
    // what catches it.
    const wrong = storyboardReduceStage(
      facts({
        armedAt: ARMED_AT,
        retrievedAt: new Date(secondsAfterArming(26)),
        readingAt: new Date(secondsAfterArming(31)),
        endedAt: new Date(secondsAfterArming(37)),
        runStatus: "completed",
        runOutcome: "produced_findings",
        finding: null,
      }),
      secondsAfterArming(37),
    );

    expect(wrong.kind).toBe("ended");
    expect(wrong.kind).not.toBe("leg2");
  });
});
