export type SacId =
  | "SAC-1"
  | "SAC-2"
  | "SAC-3"
  | "SAC-4"
  | "SAC-5"
  | "SAC-6"
  | "SAC-7"
  | "SAC-8"
  | "SAC-9"
  | "SAC-10"
  | "SAC-11"
  | "SAC-12";

export const SAC_IDS: readonly SacId[] = [
  "SAC-1",
  "SAC-2",
  "SAC-3",
  "SAC-4",
  "SAC-5",
  "SAC-6",
  "SAC-7",
  "SAC-8",
  "SAC-9",
  "SAC-10",
  "SAC-11",
  "SAC-12",
];

export type EnforcingTest = { readonly test: string; readonly file: string };

export type EnforcedSacId =
  | "SAC-1"
  | "SAC-2"
  | "SAC-3"
  | "SAC-4"
  | "SAC-5"
  | "SAC-6"
  | "SAC-7"
  | "SAC-8"
  | "SAC-9"
  | "SAC-10"
  | "SAC-11"
  | "SAC-12";

export type UnenforcedSacId = Exclude<SacId, EnforcedSacId>;

export type EnforcedSacRow = {
  readonly id: EnforcedSacId;
  readonly mayAssert: string;
  readonly mayNotAssert: string;

  readonly enforcedBy: readonly [EnforcingTest, ...EnforcingTest[]];
};

export type UnenforcedSacRow = {
  readonly id: UnenforcedSacId;
  readonly mayAssert: string;
  readonly mayNotAssert: string;

  readonly notEnforcedBecause: string;

  readonly inheritedBy: string;
};

const FLOOR_TESTS = "packages/core/__tests__/summary/floor.test.ts";
const GUARD_TESTS = "packages/core/__tests__/summary/guards.test.ts";
const FUNNEL_TESTS = "packages/core/__tests__/detect/funnel-dropoff.test.ts";
const ANALYSIS_TICK_TESTS = "worker/__tests__/tasks/analysis-tick.test.ts";
const FINDING_TEXT_REACH_TESTS = "__tests__/finding-text-reach.test.ts";

export const SAC_11_DISJOINTNESS_PROOF: EnforcingTest = {
  test: "the dropped and struggling cohorts are structurally disjoint",
  file: FUNNEL_TESTS,
};

export const SAC_CONTRACT: Record<EnforcedSacId, EnforcedSacRow> = {
  "SAC-1": {
    id: "SAC-1",
    mayAssert: "The class the gate concluded, in the customer's own terms.",
    mayNotAssert:
      "Any class the gate did not conclude; the class the detector claimed if it was downgraded; any hedged blend of the two.",
    enforcedBy: [
      {
        test: "renderFloorSummary names the class the gate concluded and never the class the detector claimed",
        file: FLOOR_TESTS,
      },
      {
        test: "renderFloorSummary refuses a candidate whose trace disagrees with its final class",
        file: FLOOR_TESTS,
      },
      {
        test: "the floor template table has exactly one entry per FindingClass",
        file: FLOOR_TESTS,
      },
    ],
  },

  "SAC-2": {
    id: "SAC-2",
    mayAssert: "A count that exists on the candidate as a measured count.",
    mayNotAssert:
      "Any number not substituted from a measured count; any number produced by a model; any derived figure — a percentage, a rank, a projection — not present on the candidate.",
    enforcedBy: [
      {
        test: "no rendered output contains a number that did not arrive by substitution from a MeasuredCount",
        file: GUARD_TESTS,
      },
      { test: "the numbers scanner reports a planted bare digit", file: GUARD_TESTS },
      {
        test: "renderFloorSummary renders both funnel counts and computes no ratio between them",
        file: FLOOR_TESTS,
      },
    ],
  },

  "SAC-3": {
    id: "SAC-3",
    mayAssert: "A count with its denominator in the same sentence.",
    mayNotAssert: "A bare count. Twenty people dropped off, without saying out of how many.",
    enforcedBy: [
      {
        test: "renderFloorSummary renders every count with its denominator in the same sentence",
        file: FLOOR_TESTS,
      },
      {
        test: "the numbers scanner reports a count rendered without its denominator",
        file: GUARD_TESTS,
      },
    ],
  },

  "SAC-4": {
    id: "SAC-4",
    mayAssert: "The surface the claim is about — the normalised url path.",
    mayNotAssert:
      "Any surface not on the candidate; any inferred page name, product area, or feature name.",
    enforcedBy: [
      { test: "renderFloorSummary names only the candidate's own surface", file: FLOOR_TESTS },
      {
        test: "renderFloorSummary refuses a candidate whose surface is not already normalised",
        file: FLOOR_TESTS,
      },
    ],
  },

  "SAC-5": {
    id: "SAC-5",
    mayAssert: "The timeframe on the candidate.",
    mayNotAssert:
      "Recently, today, this week — unless that is literally the candidate's own timeframe.",
    enforcedBy: [
      {
        test: "renderFloorSummary states the candidate's own timeframe and no relative-time phrase",
        file: FLOOR_TESTS,
      },
    ],
  },

  "SAC-6": {
    id: "SAC-6",
    mayAssert: "Absence, when the proof is an absence.",
    mayNotAssert:
      "A positive observation no predicate established. A sentence keyed by an outcome may only assert what is true on EVERY path to that outcome — this is the defect that shipped in the prior sprint.",
    enforcedBy: [
      {
        test: "renderFloorSummary states an explicit no-rate when every session in the window was set aside",
        file: FLOOR_TESTS,
      },
      {
        test: "renderFloorSummary composes its output only from imported templates and substituted values",
        file: FLOOR_TESTS,
      },
      {
        test: "renderFloorSummary refuses a candidate it cannot render rather than emitting a partial sentence",
        file: FLOOR_TESTS,
      },
    ],
  },

  "SAC-7": {
    id: "SAC-7",
    mayAssert: "Causation the evidence proves.",
    mayNotAssert:
      "Causation it does not. A failed save needs the absent network call, not an inference from repeated clicks.",
    enforcedBy: [
      { test: "the causal-connective scanner reports a planted because clause", file: GUARD_TESTS },
      {
        test: "no rendered sentence joins two claims with a causal connective",
        file: GUARD_TESTS,
      },
    ],
  },

  "SAC-8": {
    id: "SAC-8",
    mayAssert: "Plain English a non-technical co-founder reads once and understands.",
    mayNotAssert:
      "Product jargon or new vocabulary. Also barred: class identifiers, predicate names, reason codes, detector names, version numbers, and ids.",
    enforcedBy: [
      { test: "the machine-identifier scanner reports a planted class name", file: GUARD_TESTS },
      { test: "no rendered output contains a machine identifier", file: GUARD_TESTS },
      {
        test: "no module under summary declares a customer-facing sentence literal",
        file: GUARD_TESTS,
      },
    ],
  },

  "SAC-9": {
    id: "SAC-9",
    mayAssert:
      "That a summary was produced without a model, when it was, and that every path which writes or reads persisted finding text ran the residual scan.",
    mayNotAssert:
      "That the text is free of personal data. The scanner is a keyword classifier and will miss; what may be claimed is that it ran on every path, never that it found everything.",
    enforcedBy: [
      {
        test: "a candidate whose model text contains a planted PII offender persists the floor summary with summary_source floor_model_text_rejected, never the dirty text",
        file: ANALYSIS_TICK_TESTS,
      },
      {
        test: "a repo-wide scan finds no code path reading findings.headline or findings.context outside the residual-PII gate",
        file: FINDING_TEXT_REACH_TESTS,
      },
    ],
  },

  "SAC-10": {
    id: "SAC-10",
    mayAssert: "The stop reason, when the run stopped early.",
    mayNotAssert:
      "That the run was complete when a limit truncated it, or that nothing was found when the limit stopped the looking.",
    enforcedBy: [
      {
        test: "cap exhaustion records stop_reason cap_exhausted and never presents as ran_to_completion",
        file: ANALYSIS_TICK_TESTS,
      },
      {
        test: "with cap N and N plus one eligible candidates exactly N model calls occur in deterministic order",
        file: ANALYSIS_TICK_TESTS,
      },
    ],
  },

  "SAC-11": {
    id: "SAC-11",
    mayAssert:
      "Two clauses about the same surface, each naming its own count, neither borrowing the other's subject.",
    mayNotAssert:
      "That the sessions counted as dropped are the sessions counted as struggling. The two clauses may be about the same surface; never about the same people. The cohorts are structurally disjoint, so two individually true clauses would compose into one false claim.",
    enforcedBy: [
      {
        test: "the cohort-conflation scanner reports a planted sentence joining a struggle clause to a drop clause",
        file: GUARD_TESTS,
      },
      {
        test: "no rendered sentence contains both a struggle token and a drop token",
        file: GUARD_TESTS,
      },
      {
        test: "a struggling-cohort count never reaches a rendered sentence",
        file: GUARD_TESTS,
      },
      SAC_11_DISJOINTNESS_PROOF,
    ],
  },

  "SAC-12": {
    id: "SAC-12",
    mayAssert: "How much weight the evidence bears, in words, from the three-valued basis.",
    mayNotAssert:
      "A numeric confidence. There is no numeric confidence in this product, and a number here would be a precision nothing computed and the most memorable thing a reader took away, precisely because it looks exact.",
    enforcedBy: [
      {
        test: "renderFloorSummary renders the confidence basis as words and never as a number",
        file: FLOOR_TESTS,
      },
    ],
  },
};

// Empty since O-021 promoted SAC-9. `UnenforcedSacRow` stays exported for the next row
// that has to sit here before its seam exists.
export const SAC_NOT_YET_ENFORCED: Record<UnenforcedSacId, UnenforcedSacRow> = {};
