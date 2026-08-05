import { describe, expect, test } from "bun:test";

import type { MeasuredCount } from "../../src/counts/measured-count";
import { measuredCount } from "../../src/counts/measured-count";
import {
  brokenProofSatisfied,
  changedMindProofSatisfied,
  confidenceBasisForPass,
  confusingProofSatisfied,
  instrumentationProofSatisfied,
  PROOF_PREDICATE_VERSION,
  PROOF_PREDICATES,
} from "../../src/evidence/predicates";
import type { EvidenceSignal, EvidenceSignalKind } from "../../src/evidence/signals";
import { BROKEN_PROOF_SIGNALS_V1 } from "../../src/evidence/signals";
import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

const WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-08T00:00:00.000Z");
const EXCEPTION_AT = new Date("2026-07-03T12:00:00.000Z");

const SYNTHETIC_RULE_SET_VERSION = -1;

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

function failureCorrelated(): EvidenceSignal {
  return {
    kind: "failure_correlated",
    eventName: "$exception",
    occurredAt: EXCEPTION_AT,
    precedingActionName: "save_clicked",
    correlationWindowMs: 30_000,

    correlatedSessions: measuredCount({
      numerator: 3,
      denominator: 10,
      unit: "sessions",
      timeframe: { start: new Date("2026-04-06"), end: new Date("2026-04-13") },
      basis: { totalInWindow: 10, kept: 10, setAside: [], keptUnchecked: 0 },
    }),
  };
}

function failureUncorrelated(): EvidenceSignal {
  return { kind: "failure_uncorrelated", eventName: "$exception", occurredAt: EXCEPTION_AT };
}

const STRUGGLE_COHORT_KEPT = 40;

const STRUGGLING_SESSIONS_ABOVE_MINIMUM = 8;

function struggle(
  attempts: number,
  strugglingSessions: number = STRUGGLING_SESSIONS_ABOVE_MINIMUM,
): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "repeated_attempt",
    surface: "/checkout",
    attempts,
    strugglingSessions: sessionsCount(strugglingSessions, STRUGGLE_COHORT_KEPT),
  };
}

function backtrack(attempts: number): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "backtrack",
    surface: "/checkout",
    attempts,
    strugglingSessions: sessionsCount(STRUGGLING_SESSIONS_ABOVE_MINIMUM, STRUGGLE_COHORT_KEPT),
  };
}

function cleanExit(): EvidenceSignal {
  return { kind: "clean_exit", surface: "/checkout" };
}

function sessionsCount(numerator: number, denominator: number): MeasuredCount {
  return measuredCount({
    numerator,
    denominator,
    unit: "sessions",
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: denominator, kept: denominator, setAside: [], keptUnchecked: 0 },
  });
}

const RATE_DROP_DENOMINATOR = 200;

function rateDrop(observedNumerator: number, expectedNumerator: number): EvidenceSignal {
  return {
    kind: "instrumentation_rate_drop",
    eventName: "checkout_completed",
    observed: sessionsCount(observedNumerator, RATE_DROP_DENOMINATOR),
    expected: sessionsCount(expectedNumerator, RATE_DROP_DENOMINATOR),
  };
}

function signalOfKind(kind: EvidenceSignalKind): EvidenceSignal {
  switch (kind) {
    case "failure_correlated":
      return failureCorrelated();
    case "failure_uncorrelated":
      return failureUncorrelated();
    case "struggle":
      return struggle(3);
    case "clean_exit":
      return cleanExit();
    case "instrumentation_rate_drop":
      return rateDrop(0, 100);
  }
}

// TODO(O-041 D-9): delete ObservedThresholds and observedRuleSetV1's guard once
// ThresholdRuleSet carries these six members; the alias then collapses to ThresholdRuleSet.
type ObservedThresholds = {
  readonly struggleRageClickMin: number;
  readonly struggleDeadClickMin: number;
  readonly struggleFieldAbandonedMin: number;
  readonly struggleFieldRefocusMin: number;
  readonly struggleScrollBackMin: number;
  readonly struggleObservedMinSessions: number;
};

type ObservedRuleSet = ThresholdRuleSet & ObservedThresholds;

const OBSERVED_THRESHOLD_MEMBERS = [
  "struggleRageClickMin",
  "struggleDeadClickMin",
  "struggleFieldAbandonedMin",
  "struggleFieldRefocusMin",
  "struggleScrollBackMin",
  "struggleObservedMinSessions",
] as const;

function observedRuleSetV1(): ObservedRuleSet {
  const rules = ruleSetV1();
  const carried: Record<string, unknown> = { ...rules };

  const missing = OBSERVED_THRESHOLD_MEMBERS.filter(
    (member) => typeof carried[member] !== "number",
  );

  if (missing.length > 0) {
    throw new Error(
      `ThresholdRuleSet carries no ${missing.join(", ")} — O-041 D-9 has not landed. ` +
        `Every magnitude below must come off the rule set, never a literal.`,
    );
  }

  return rules as ObservedRuleSet;
}

// TODO(O-041 D-7): import the subkind union from src/evidence/signals.ts once it grows
// past "repeated_attempt" | "backtrack"; this local copy is Wave 0 scaffolding only.
type ObservedStruggleSubkind =
  "rage_click" | "dead_click" | "field_abandoned" | "field_refocus" | "scroll_back";

function observedStruggle(
  subkind: ObservedStruggleSubkind,
  attempts: number,
  strugglingSessions: number,
): EvidenceSignal {
  return {
    kind: "struggle",
    subkind,
    surface: "/checkout",
    attempts,
    strugglingSessions: sessionsCount(strugglingSessions, STRUGGLE_COHORT_KEPT),
  } as unknown as EvidenceSignal;
}

function rageClick(attempts: number, strugglingSessions: number): EvidenceSignal {
  return observedStruggle("rage_click", attempts, strugglingSessions);
}

function deadClick(attempts: number, strugglingSessions: number): EvidenceSignal {
  return observedStruggle("dead_click", attempts, strugglingSessions);
}

function fieldAbandoned(attempts: number, strugglingSessions: number): EvidenceSignal {
  return observedStruggle("field_abandoned", attempts, strugglingSessions);
}

function fieldRefocus(attempts: number, strugglingSessions: number): EvidenceSignal {
  return observedStruggle("field_refocus", attempts, strugglingSessions);
}

function scrollBack(attempts: number, strugglingSessions: number): EvidenceSignal {
  return observedStruggle("scroll_back", attempts, strugglingSessions);
}

function sessionsClear(rules: ObservedRuleSet): number {
  return rules.struggleObservedMinSessions + 1;
}

describe("brokenProofSatisfied", () => {
  test("should satisfy broken proof when a failure_correlated signal is present", () => {
    expect(brokenProofSatisfied([failureCorrelated()], ruleSetV1())).toBe(true);
  });

  test("should NOT satisfy broken proof from a failure_uncorrelated signal", () => {
    const rules = ruleSetV1();

    expect(brokenProofSatisfied([failureUncorrelated()], rules)).toBe(false);

    expect(
      brokenProofSatisfied(
        [failureUncorrelated(), failureUncorrelated(), failureUncorrelated()],
        rules,
      ),
    ).toBe(false);

    expect(brokenProofSatisfied([failureUncorrelated(), failureCorrelated()], rules)).toBe(true);
  });

  test("BROKEN_PROOF_SIGNALS_V1 is the versioned constant the rule set reads, and every member satisfies", () => {
    expect(BROKEN_PROOF_SIGNALS_V1).toEqual(["failure_correlated"]);
    expect(ruleSetV1().brokenProofSignals).toBe(BROKEN_PROOF_SIGNALS_V1);

    for (const kind of BROKEN_PROOF_SIGNALS_V1) {
      expect(brokenProofSatisfied([signalOfKind(kind)], ruleSetV1())).toBe(true);
    }
  });

  test("should downgrade a broken claim with struggle signals but no failure signal to confusing", () => {
    const rules = ruleSetV1();

    const signals = [
      struggle(rules.struggleRepeatedAttemptMin),
      struggle(rules.struggleRepeatedAttemptMin),
    ];

    expect(brokenProofSatisfied(signals, rules)).toBe(false);
    expect(confusingProofSatisfied(signals, rules)).toBe(true);
  });
});

describe("confusingProofSatisfied", () => {
  test("should satisfy confusing proof when a struggle signal is present", () => {
    const rules = ruleSetV1();

    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);
    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin + 1)], rules)).toBe(
      true,
    );

    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin - 1)], rules)).toBe(
      false,
    );

    expect(confusingProofSatisfied([], rules)).toBe(false);
  });

  test("should not satisfy confusing proof below struggleRepeatedAttemptMin", () => {
    const rules = ruleSetV1();
    const belowMinimum = rules.struggleRepeatedAttemptMin - 1;

    expect(belowMinimum).toBeGreaterThanOrEqual(2);

    expect(confusingProofSatisfied([struggle(belowMinimum)], rules)).toBe(false);
    expect(confusingProofSatisfied([struggle(1)], rules)).toBe(false);

    expect(
      confusingProofSatisfied(
        [struggle(belowMinimum), struggle(belowMinimum), struggle(belowMinimum)],
        rules,
      ),
    ).toBe(false);

    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);
  });

  test("should not satisfy confusing proof below struggleMinStrugglingSessions", () => {
    const rules = ruleSetV1();
    const outlier = rules.struggleMinStrugglingSessions - 1;

    expect(outlier).toBeGreaterThanOrEqual(1);

    expect(
      confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin, outlier)], rules),
    ).toBe(false);
    expect(
      confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin * 10, outlier)], rules),
    ).toBe(false);

    expect(
      confusingProofSatisfied(
        [
          struggle(rules.struggleRepeatedAttemptMin, outlier),
          struggle(rules.struggleRepeatedAttemptMin, outlier),
          struggle(rules.struggleRepeatedAttemptMin, outlier),
        ],
        rules,
      ),
    ).toBe(false);

    expect(
      confusingProofSatisfied(
        [struggle(rules.struggleRepeatedAttemptMin, rules.struggleMinStrugglingSessions)],
        rules,
      ),
    ).toBe(true);
  });

  test("should not satisfy confusing proof from a backtrack signal at any magnitude", () => {
    const rules = ruleSetV1();

    for (const attempts of [0, 1, rules.struggleRepeatedAttemptMin, 99, 1000]) {
      expect(confusingProofSatisfied([backtrack(attempts)], rules)).toBe(false);
    }

    expect(confusingProofSatisfied([backtrack(9), backtrack(9), backtrack(9)], rules)).toBe(false);
    expect(confusingProofSatisfied([backtrack(9), cleanExit()], rules)).toBe(false);

    expect(confusingProofSatisfied([struggle(rules.struggleRepeatedAttemptMin)], rules)).toBe(true);

    expect(changedMindProofSatisfied([cleanExit(), backtrack(1)], rules)).toBe(false);

    expect(confidenceBasisForPass([backtrack(1000)], "confusing", rules)).toBe("threshold_met");
  });
});

describe("observed struggle subkinds — fail directions (O-041 D-8, D-9)", () => {
  test("should not satisfy confusing proof below struggleRageClickMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confusingProofSatisfied([rageClick(rules.struggleRageClickMin - 1, sessions)], rules),
    ).toBe(false);

    expect(confusingProofSatisfied([rageClick(rules.struggleRageClickMin, sessions)], rules)).toBe(
      true,
    );
  });

  test("should not satisfy confusing proof below struggleDeadClickMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confusingProofSatisfied([deadClick(rules.struggleDeadClickMin - 1, sessions)], rules),
    ).toBe(false);

    expect(confusingProofSatisfied([deadClick(rules.struggleDeadClickMin, sessions)], rules)).toBe(
      true,
    );
  });

  test("should not satisfy confusing proof below struggleFieldAbandonedMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confusingProofSatisfied(
        [fieldAbandoned(rules.struggleFieldAbandonedMin - 1, sessions)],
        rules,
      ),
    ).toBe(false);

    expect(
      confusingProofSatisfied([fieldAbandoned(rules.struggleFieldAbandonedMin, sessions)], rules),
    ).toBe(true);
  });

  test("should not satisfy confusing proof below struggleFieldRefocusMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confusingProofSatisfied([fieldRefocus(rules.struggleFieldRefocusMin - 1, sessions)], rules),
    ).toBe(false);

    expect(
      confusingProofSatisfied([fieldRefocus(rules.struggleFieldRefocusMin, sessions)], rules),
    ).toBe(true);
  });

  test("should not satisfy confusing proof below struggleScrollBackMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confusingProofSatisfied([scrollBack(rules.struggleScrollBackMin - 1, sessions)], rules),
    ).toBe(false);

    expect(
      confusingProofSatisfied([scrollBack(rules.struggleScrollBackMin, sessions)], rules),
    ).toBe(true);
  });

  test("should not satisfy confusing proof below struggleObservedMinSessions", () => {
    const rules = observedRuleSetV1();
    const attemptsClear = rules.struggleRageClickMin + 1;

    expect(
      confusingProofSatisfied(
        [rageClick(attemptsClear, rules.struggleObservedMinSessions - 1)],
        rules,
      ),
    ).toBe(false);

    expect(
      confusingProofSatisfied([rageClick(attemptsClear, rules.struggleObservedMinSessions)], rules),
    ).toBe(true);
  });
});

describe("changedMindProofSatisfied", () => {
  test("should satisfy changed_mind proof only when clean_exit is present AND no failure and no struggle signal exist", () => {
    const rules = ruleSetV1();

    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    expect(changedMindProofSatisfied([cleanExit(), failureCorrelated()], rules)).toBe(false);
    expect(changedMindProofSatisfied([cleanExit(), failureUncorrelated()], rules)).toBe(false);
    expect(
      changedMindProofSatisfied([cleanExit(), struggle(rules.struggleRepeatedAttemptMin)], rules),
    ).toBe(false);

    expect(changedMindProofSatisfied([], rules)).toBe(false);
  });

  test("should block changed_mind on a struggle signal of any kind at any magnitude", () => {
    const rules = ruleSetV1();

    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    for (let attempts = 0; attempts < rules.struggleRepeatedAttemptMin; attempts += 1) {
      const weak = struggle(attempts);

      expect(confusingProofSatisfied([weak], rules)).toBe(false);

      expect(changedMindProofSatisfied([cleanExit(), weak], rules)).toBe(false);
    }

    expect(changedMindProofSatisfied([cleanExit(), backtrack(0)], rules)).toBe(false);
    expect(changedMindProofSatisfied([cleanExit(), backtrack(1)], rules)).toBe(false);
    expect(
      changedMindProofSatisfied([cleanExit(), backtrack(rules.struggleRepeatedAttemptMin)], rules),
    ).toBe(false);
  });
});

describe("instrumentationProofSatisfied", () => {
  test("should satisfy instrumentation proof when the rate crosses instrumentationDropRatio", () => {
    const rules = ruleSetV1();

    const expectedNumerator = rules.instrumentationMinExpected * 2;

    const atBoundary = (expectedNumerator * rules.instrumentationDropRatioPercent) / 100;

    expect(instrumentationProofSatisfied([rateDrop(atBoundary, expectedNumerator)], rules)).toBe(
      true,
    );

    expect(instrumentationProofSatisfied([rateDrop(0, expectedNumerator)], rules)).toBe(true);

    expect(
      instrumentationProofSatisfied([rateDrop(atBoundary + 1, expectedNumerator)], rules),
    ).toBe(false);
  });

  test("should not satisfy instrumentation proof below instrumentationMinExpected", () => {
    const rules = ruleSetV1();

    expect(
      instrumentationProofSatisfied([rateDrop(0, rules.instrumentationMinExpected - 1)], rules),
    ).toBe(false);

    expect(
      instrumentationProofSatisfied([rateDrop(0, rules.instrumentationMinExpected)], rules),
    ).toBe(true);
  });
});

describe("predicates read the rule-set parameter, never the module constant", () => {
  test("should follow the rule set it is handed when its proof-signal list differs from v1", () => {
    const admitsUncorrelated: ThresholdRuleSet = {
      ...ruleSetV1(),
      version: SYNTHETIC_RULE_SET_VERSION,
      brokenProofSignals: ["failure_uncorrelated"],
      confusingProofSignals: ["clean_exit"],
    };

    expect(brokenProofSatisfied([failureUncorrelated()], admitsUncorrelated)).toBe(true);
    expect(brokenProofSatisfied([failureCorrelated()], admitsUncorrelated)).toBe(false);

    expect(confusingProofSatisfied([cleanExit()], admitsUncorrelated)).toBe(true);
    expect(
      confusingProofSatisfied(
        [struggle(admitsUncorrelated.struggleRepeatedAttemptMin)],
        admitsUncorrelated,
      ),
    ).toBe(false);

    expect(brokenProofSatisfied([failureUncorrelated()], ruleSetV1())).toBe(false);
  });
});

describe("confidenceBasisForPass", () => {
  test("reports at_threshold when the proving struggle sits exactly at both minimums", () => {
    const rules = ruleSetV1();
    const signal = struggle(rules.struggleRepeatedAttemptMin, rules.struggleMinStrugglingSessions);

    expect(confidenceBasisForPass([signal], "confusing", rules)).toBe("at_threshold");
  });

  test("reports at_threshold when EITHER struggle magnitude is at its boundary, since one fewer would not fire", () => {
    const rules = ruleSetV1();

    const attemptsAtBoundary = struggle(
      rules.struggleRepeatedAttemptMin,
      STRUGGLING_SESSIONS_ABOVE_MINIMUM,
    );

    expect(confidenceBasisForPass([attemptsAtBoundary], "confusing", rules)).toBe("at_threshold");
  });

  test("reports threshold_met when the proving signal clears both minimums with room", () => {
    const rules = ruleSetV1();
    const signal = struggle(
      rules.struggleRepeatedAttemptMin + 1,
      rules.struggleMinStrugglingSessions + 1,
    );

    expect(confidenceBasisForPass([signal], "confusing", rules)).toBe("threshold_met");
  });

  test("reports threshold_met when ANY proving signal clears with room beside one at the boundary", () => {
    const rules = ruleSetV1();
    const atBoundary = struggle(
      rules.struggleRepeatedAttemptMin,
      rules.struggleMinStrugglingSessions,
    );
    const clear = struggle(
      rules.struggleRepeatedAttemptMin + 2,
      rules.struggleMinStrugglingSessions + 2,
    );

    expect(confidenceBasisForPass([atBoundary, clear], "confusing", rules)).toBe("threshold_met");
  });

  test("reports threshold_met for presence-only proof, which has no boundary to sit at", () => {
    const rules = ruleSetV1();

    expect(confidenceBasisForPass([cleanExit()], "changed_mind", rules)).toBe("threshold_met");
  });

  test("reports at_threshold for a broken pass whose correlated cohort is exactly the minimum", () => {
    const rules = ruleSetV1();

    expect(rules.errorMinAffectedSessions).toBe(3);

    expect(confidenceBasisForPass([failureCorrelated()], "broken", rules)).toBe("at_threshold");
  });

  test("ignores a signal of an unadmitted kind when deriving the basis, as the predicates do", () => {
    const rules = ruleSetV1();

    const signals = [
      struggle(rules.struggleRepeatedAttemptMin, rules.struggleMinStrugglingSessions),
      failureUncorrelated(),
    ];

    expect(confidenceBasisForPass(signals, "confusing", rules)).toBe("at_threshold");
  });
});

describe("observed struggle subkinds — at_threshold boundaries (O-041 D-8, PRD FR-5/AC-9)", () => {
  test("should record at_threshold for a rage_click signal exactly at struggleRageClickMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confidenceBasisForPass([rageClick(rules.struggleRageClickMin, sessions)], "confusing", rules),
    ).toBe("at_threshold");

    expect(
      confidenceBasisForPass(
        [rageClick(rules.struggleRageClickMin + 1, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("threshold_met");
  });

  test("should record at_threshold for a dead_click signal exactly at struggleDeadClickMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confidenceBasisForPass([deadClick(rules.struggleDeadClickMin, sessions)], "confusing", rules),
    ).toBe("at_threshold");

    expect(
      confidenceBasisForPass(
        [deadClick(rules.struggleDeadClickMin + 1, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("threshold_met");
  });

  test("should record at_threshold for a field_abandoned signal exactly at struggleFieldAbandonedMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confidenceBasisForPass(
        [fieldAbandoned(rules.struggleFieldAbandonedMin, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("at_threshold");

    expect(
      confidenceBasisForPass(
        [fieldAbandoned(rules.struggleFieldAbandonedMin + 1, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("threshold_met");
  });

  test("should record at_threshold for a field_refocus signal exactly at struggleFieldRefocusMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confidenceBasisForPass(
        [fieldRefocus(rules.struggleFieldRefocusMin, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("at_threshold");

    expect(
      confidenceBasisForPass(
        [fieldRefocus(rules.struggleFieldRefocusMin + 1, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("threshold_met");
  });

  test("should record at_threshold for a scroll_back signal exactly at struggleScrollBackMin", () => {
    const rules = observedRuleSetV1();
    const sessions = sessionsClear(rules);

    expect(
      confidenceBasisForPass(
        [scrollBack(rules.struggleScrollBackMin, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("at_threshold");

    expect(
      confidenceBasisForPass(
        [scrollBack(rules.struggleScrollBackMin + 1, sessions)],
        "confusing",
        rules,
      ),
    ).toBe("threshold_met");
  });

  test("should record at_threshold for an observed signal exactly at struggleObservedMinSessions", () => {
    const rules = observedRuleSetV1();
    const attemptsClear = rules.struggleRageClickMin + 1;

    expect(
      confidenceBasisForPass(
        [rageClick(attemptsClear, rules.struggleObservedMinSessions)],
        "confusing",
        rules,
      ),
    ).toBe("at_threshold");

    expect(
      confidenceBasisForPass(
        [rageClick(attemptsClear, rules.struggleObservedMinSessions + 1)],
        "confusing",
        rules,
      ),
    ).toBe("threshold_met");
  });
});

type ThresholdPosition = "below" | "at" | "above";

type PreSprintVerdict = {
  readonly attempts: ThresholdPosition;
  readonly sessions: ThresholdPosition;
  readonly confusing: boolean;
  readonly basis: "threshold_met" | "at_threshold";
};

// Frozen before O-041. Read off the shipped predicate, never regenerated from it.
const PRE_O041_REPEATED_ATTEMPT_VERDICTS: readonly PreSprintVerdict[] = [
  { attempts: "below", sessions: "below", confusing: false, basis: "threshold_met" },
  { attempts: "below", sessions: "at", confusing: false, basis: "threshold_met" },
  { attempts: "below", sessions: "above", confusing: false, basis: "threshold_met" },
  { attempts: "at", sessions: "below", confusing: false, basis: "threshold_met" },
  { attempts: "at", sessions: "at", confusing: true, basis: "at_threshold" },
  { attempts: "at", sessions: "above", confusing: true, basis: "at_threshold" },
  { attempts: "above", sessions: "below", confusing: false, basis: "threshold_met" },
  { attempts: "above", sessions: "at", confusing: true, basis: "at_threshold" },
  { attempts: "above", sessions: "above", confusing: true, basis: "threshold_met" },
];

function offsetOf(position: ThresholdPosition): number {
  switch (position) {
    case "below":
      return -1;
    case "at":
      return 0;
    case "above":
      return 1;
  }
}

function repeatedAttemptAt(rules: ThresholdRuleSet, row: PreSprintVerdict): EvidenceSignal {
  return struggle(
    rules.struggleRepeatedAttemptMin + offsetOf(row.attempts),
    rules.struggleMinStrugglingSessions + offsetOf(row.sessions),
  );
}

describe("O-041 leaves every pre-sprint verdict where it was (D-5, D-1)", () => {
  test("should not change any pre-O-041 confusing verdict for a repeated_attempt signal", () => {
    const rules = ruleSetV1();

    for (const row of PRE_O041_REPEATED_ATTEMPT_VERDICTS) {
      const signal = repeatedAttemptAt(rules, row);

      expect({
        attempts: row.attempts,
        sessions: row.sessions,
        confusing: confusingProofSatisfied([signal], rules),
        basis: confidenceBasisForPass([signal], "confusing", rules),
      }).toEqual(row);
    }
  });

  test("should not change any pre-O-041 changed_mind verdict for a repeated_attempt signal", () => {
    const rules = ruleSetV1();

    expect(changedMindProofSatisfied([cleanExit()], rules)).toBe(true);

    for (const row of PRE_O041_REPEATED_ATTEMPT_VERDICTS) {
      const signal = repeatedAttemptAt(rules, row);

      expect(changedMindProofSatisfied([cleanExit(), signal], rules)).toBe(false);
    }
  });

  test("should keep PROOF_PREDICATE_VERSION at 1 because no recorded signal is judged differently", () => {
    expect(PROOF_PREDICATE_VERSION).toBe(1);

    for (const predicate of Object.values(PROOF_PREDICATES)) {
      expect(predicate.version).toBe(PROOF_PREDICATE_VERSION);
    }
  });
});
