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

const loadReduceStage = (): Promise<ReduceStage> =>
  loadUnderConstruction<ReduceStage>({
    modulePath: "../../src/onboarding/stage",
    exportName: "reduceStage",
    ownedBy: "ADD Wave 1, task 1c.1",
  });

const ARMED_AT = new Date("2026-08-01T10:00:00.000Z");
const ARMED_MS = ARMED_AT.getTime();

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
  test("completed persisted state with no live signal renders done, not loading", async () => {
    const reduceStage = await loadReduceStage();

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

      secondsAfterArming(86_400),
    );

    expect(state.kind).toBe("finding");
    expect(state).toMatchObject({ kind: "finding", finding: FINDING });
  });

  test("no persisted state and no live signal renders the first waiting stage", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(facts({ armedAt: ARMED_AT }), secondsAfterArming(3));

    expect(state.kind).toBe("leg1");
  });

  test("a live signal arriving before the persisted row does not render done", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
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

    expect(state.kind).toBe("leg2");
    expect(state.kind).not.toBe("ended");
    expect(state.kind).not.toBe("finding");
  });

  test("a finding persisted before the user landed renders immediately on first paint", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(facts({ finding: FINDING }), secondsAfterArming(37));

    expect(state.kind).toBe("finding");

    expect(state).toMatchObject({ kind: "finding" });
    if (state.kind === "finding") {
      expect(Number.isFinite(state.elapsedSeconds)).toBe(true);
      expect(state.elapsedSeconds).toBeGreaterThanOrEqual(0);
    }
  });

  test("an unarmed surface with no finding renders unarmed", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(NOTHING, ARMED_MS);

    expect(state).toEqual({ kind: "unarmed" });
  });

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

  test("readingAt null with armedAt set renders leg1", async () => {
    const reduceStage = await loadReduceStage();

    const state = reduceStage(
      facts({ armedAt: ARMED_AT, retrievedAt: new Date(secondsAfterArming(26)) }),
      secondsAfterArming(28),
    );

    expect(state.kind).toBe("leg1");
  });

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

    if (state.kind === "ended") {
      expect(ANALYSIS_RUN_STATUS_MESSAGES[state.reason as "failed"]).toBeTruthy();
    }
  });

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

  test("elapsed is now minus armedAt, recomputed, for every non-unarmed state", async () => {
    const reduceStage = await loadReduceStage();

    const waiting = facts({ armedAt: ARMED_AT });
    const reading = facts({
      armedAt: ARMED_AT,
      retrievedAt: new Date(secondsAfterArming(26)),
      readingAt: new Date(secondsAfterArming(31)),
      runStatus: "running",
    });

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

    expect(reduceStage(ended, secondsAfterArming(37))).toMatchObject({ elapsedSeconds: 37 });
    expect(reduceStage(ended, secondsAfterArming(9_000))).toMatchObject({ elapsedSeconds: 37 });

    expect(reduceStage(found, secondsAfterArming(9_000))).toMatchObject({
      kind: "finding",
      elapsedSeconds: 37,
    });
  });

  test("readingAt without retrievedAt is a designed state, not a crash", async () => {
    const reduceStage = await loadReduceStage();

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

    const start = Date.now();
    while (Date.now() - start < 5) {
      /* burn a few real milliseconds */
    }
    expect(reduceStage(input, at)).toEqual(first);

    expect(input.readingAt).toEqual(new Date(secondsAfterArming(31)));
  });
});

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
    const wrong = storyboardReduceStage(facts({ finding: FINDING }), secondsAfterArming(37));

    expect(wrong.kind).toBe("unarmed");
    expect(wrong.kind).not.toBe("finding");
  });

  test("CONTROL: the storyboard's missing out-of-order guard renders ended over a finding already written", () => {
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
