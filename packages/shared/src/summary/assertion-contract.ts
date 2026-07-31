// The String Assertion Contract, SAC-1…SAC-12 (O-005 D-11, FR-F9).
//
// WHY THIS FILE EXISTS AT ALL, and it is not documentation. SAC-1…SAC-10 lived
// only in `tasks/cold-start-analysis-lane/prd.md` and SAC-11 only in
// `docs/adds/cold-start-analysis-lane.md`. BOTH ARE GITIGNORED. One `/prune-ai`
// run, one `rm -rf tasks/`, and the rules governing the most customer-facing
// string this product produces would have been gone with no trace in history.
// Transcribing them into a git-tracked module is the whole point; the typed
// partition below is what stops the transcription rotting.
//
// THE RULE THE CONTRACT YIELDS, stated once so it survives paraphrase:
//
//   The summary is a rendering of a proof. Every assertion in it must be
//   traceable to a field on the `CandidateFinding` or to the gate's own reason
//   table. A sentence that is true only on the path its author imagined is a
//   false sentence on every other path, and it will ship.
//
// WHY NOT `messages.ts`. The plain-English audit at
// `packages/shared/__tests__/summary/messages.test.ts:79-97` derives its corpus
// from that module's exported strings and objects-of-strings. The row prose
// below uses "schema", "enum", "payload" and "null" — all on the jargon
// denylist — so folding it in would fail an audit it is not a subject of. A
// sibling module stays git-tracked, stays in `shared` (importable by `core` and
// by a future worker), and keeps `messages.ts` the pure vocabulary layer.
//
// THE PARTITION IS COMPILE-TOTAL. `UnenforcedSacId` is `Exclude<SacId,
// EnforcedSacId>`, so a `SacId` that appears in neither record fails
// `bun run typecheck` before any test runs. A row cannot quietly present as
// enforced, and a row with no enforcing test cannot be written at all — the
// tuple type below requires at least one citation.
//
// NO ROW MAY FABRICATE A CITATION. Two rows honestly cannot cite a test:
// SAC-9 has no generated text to make a claim about, and SAC-10 has no cap.
// Forcing a citation on either would manufacture a false claim inside the one
// module whose entire purpose is eliminating false claims — so they live in
// `SAC_NOT_YET_ENFORCED`, each naming why and who inherits it.

/** Every row id in the contract. */
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

/**
 * A named test that enforces a row.
 *
 * `test` is the VERBATIM string passed to `test(...)`, and `file` is the
 * workspace-relative path it lives in. Both are resolved mechanically by
 * `packages/shared/__tests__/summary/assertion-contract.test.ts` — a citation
 * naming a test that does not exist is a failure, never a skip.
 */
export type EnforcingTest = { readonly test: string; readonly file: string };

/** The rows that are enforced today. */
export type EnforcedSacId =
  | "SAC-1"
  | "SAC-2"
  | "SAC-3"
  | "SAC-4"
  | "SAC-5"
  | "SAC-6"
  | "SAC-7"
  | "SAC-8"
  | "SAC-11"
  | "SAC-12";

/** The partition is TOTAL by construction — this is derived, never written. */
export type UnenforcedSacId = Exclude<SacId, EnforcedSacId>;

export type EnforcedSacRow = {
  readonly id: EnforcedSacId;
  readonly mayAssert: string;
  readonly mayNotAssert: string;
  /** Non-empty TUPLE — a row with no cited test is a COMPILE error. */
  readonly enforcedBy: readonly [EnforcingTest, ...EnforcingTest[]];
};

export type UnenforcedSacRow = {
  readonly id: UnenforcedSacId;
  readonly mayAssert: string;
  readonly mayNotAssert: string;
  /** Why no test can exist yet. Never "TODO" — the reason is the row's value. */
  readonly notEnforcedBecause: string;
  /** Who inherits the obligation, by outcome id. */
  readonly inheritedBy: string;
};

const FLOOR_TESTS = "packages/core/__tests__/summary/floor.test.ts";
const GUARD_TESTS = "packages/core/__tests__/summary/guards.test.ts";
const FUNNEL_TESTS = "packages/core/__tests__/detect/funnel-dropoff.test.ts";

/**
 * The structural proof SAC-11 rests on.
 *
 * SAC-11 claims the dropped and struggling cohorts are *provably* disjoint. That
 * claim is itself an assertion, so it carries its own citation: if the proof
 * test were renamed or deleted, "provably disjoint" would silently become an
 * unsupported claim inside the contract that forbids unsupported claims.
 */
export const SAC_11_DISJOINTNESS_PROOF: EnforcingTest = {
  test: "D-2a — the dropped and struggling cohorts are structurally disjoint",
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
        test: "renderFloorSummary reads finalClass and never recomputes a class from the trace",
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
        test: "a CandidateFinding carries no struggling-cohort count for the renderer to conflate",
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

export const SAC_NOT_YET_ENFORCED: Record<UnenforcedSacId, UnenforcedSacRow> = {
  "SAC-9": {
    id: "SAC-9",
    mayAssert: "That a summary was produced without a model, when it was.",
    mayNotAssert:
      "That generated text has been scanned for residual personal data. No such claim may appear in code, comment, doc, or string.",
    notEnforcedBecause:
      "No model call exists in this repository, so no generated text exists for such a claim to be made about. A test asserting the absence of a claim nothing could make would pass vacuously and would read as coverage.",
    inheritedBy: "O-007 — the residual scanner ships with delivery.",
  },

  "SAC-10": {
    id: "SAC-10",
    mayAssert: "The stop reason, when the run stopped early.",
    mayNotAssert:
      "That the run was complete when a limit truncated it, or that nothing was found when the limit stopped the looking.",
    notEnforcedBecause:
      "No per-project limit on written explanations exists in this repository in any form. The value a caller may pass naming an exhausted limit is a parameter, not evidence that a limit is enforced anywhere.",
    inheritedBy: "O-005 follow-on — the sprint that builds the model call and its cap.",
  },
};
