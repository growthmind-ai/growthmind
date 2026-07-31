// ADD §7 "Golden-fixture tests — D12 churn" (O-006, Wave 0, NEVER CUT).
//
// This file is the direct proof of O-006's fourth definition-of-done clause:
// "a golden-fixture test proves signature stability across surface churn
// (D-12), with surfaces as URL paths, so the later ts-morph swap is absorbed
// by ancestry rather than a re-key."
//
// ── THE ONE THING THIS FILE CANNOT DO, AND WHY (ADD §2 D-1) ─────────────────
//
// `packages/core` cannot import `sha256Hex` — it lives in `packages/db`, and
// `core → db` is FORBIDDEN, including from a test file (a test importing a
// workspace package outside its own package's dependency graph is the same
// layering violation with a different excuse). So every assertion below
// compares `signatureTuple()`'s output STRINGS, never a hex digest. This is
// the correct unit boundary, not a workaround: `sha256Hex` is a pure
// deterministic function of its input string, so a difference in the tuple
// string is EXACTLY a difference in the digest, and `packages/core` is the
// package that owns the tuple string. The one real hex digest this sprint
// pins is T-DB-6, in `packages/db/__tests__/services/signature-ledger.service.test.ts`.
//
// ── WAVE 1 IMPLEMENTATION STATUS ─────────────────────────────────────────
//
// `signatureTuple`'s v1 serialiser body is now implemented
// (`packages/core/src/findings/signature-tuple.ts`), and every test below is
// GREEN. `GOLDEN_V1_TUPLE_BASELINE` was pinned by actually running
// `signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)` once and
// capturing its exact output (the W0-5 discipline, `probes.md`) — never
// guessed, never derived by hand from `canonicalJson` in this file.
//
// Two kinds of assertion appear below (the ADD's own split):
//   (1) RELATIONAL fork / no-fork assertions — the real D12 content, and
//       independent of any literal. These compare two outputs of the SAME
//       real `signatureTuple` call to each other.
//   (2) One ABSOLUTE GOLDEN LITERAL — `GOLDEN_V1_TUPLE_BASELINE`, pinned to
//       the byte-string actually produced by `signatureTuple`.
//
// Every fixture surface/name below is synthetic (`/checkout`, `/pay`,
// `acme.example`-style placeholders never appear) — this repository is
// PUBLIC (no real customer data, no strategy, no personas).
import { normaliseUrlPath, URL_PATH_NORMALISATION_VERSION } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import type { EvidenceSignal } from "../../src/evidence/signals";
import { EVIDENCE_SHAPE_VERSION, evidenceShape } from "../../src/findings/evidence-shape";
import type { EvidenceShapeInput } from "../../src/findings/evidence-shape";
import { SIGNATURE_TUPLE_VERSION, signatureTuple } from "../../src/findings/signature-tuple";
import type { SignatureTupleInput } from "../../src/findings/signature-tuple";
import { canonicalJson } from "../../src/serialise/canonical-json";
import type { CanonicalObject } from "../../src/serialise/canonical-json";

// --- fixture time (no Date.now() anywhere in this file, per house rules) ----

const FIXED_AT = new Date("2026-06-01T10:00:00.000Z");
const FIXED_WINDOW_END = new Date("2026-06-08T10:00:00.000Z");

// --- a synthetic project id — a randomUUID-shaped literal, never real data --

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

// --- fixture helpers ---------------------------------------------------------

/** `evidenceShape`'s serialiser refuses an un-normalised surface — build every
 * fixture surface through the real function, never as a hand-typed literal
 * (mirrors `evidence-shape.test.ts`'s `normalisedSurface`). */
function mustNormalise(rawPathname: string): string {
  const normalised = normaliseUrlPath(rawPathname, null);
  if (normalised === null) {
    throw new Error(`fixture pathname must normalise to a surface: ${rawPathname}`);
  }
  return normalised;
}

function struggleSignal(surface: string): EvidenceSignal {
  return {
    kind: "struggle",
    subkind: "repeated_attempt",
    surface,
    attempts: 3,
    strugglingSessions: measuredCount({
      numerator: 3,
      denominator: 10,
      unit: "sessions",
      timeframe: { start: FIXED_AT, end: FIXED_WINDOW_END },
      basis: { totalInWindow: 10, kept: 10, setAside: [] },
    }),
  };
}

function failureUncorrelatedSignal(): EvidenceSignal {
  return { kind: "failure_uncorrelated", eventName: "$exception", occurredAt: FIXED_AT };
}

/**
 * The evidence-shape INPUT for a given surface, holding everything else
 * fixed. Two struggle signals + one uncorrelated failure, in this exact
 * order, so `signalKinds` sorts+dedupes to `["failure_uncorrelated",
 * "struggle"]` — matching W0-5's pinned fixture exactly when `surface` is
 * `/checkout`.
 */
function shapeInputWithSurface(surface: string): EvidenceShapeInput {
  return {
    detector: "funnel_dropoff",
    surface,
    surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
    signals: [struggleSignal(surface), failureUncorrelatedSignal(), struggleSignal(surface)],
    symptomClass: "broken",
  };
}

// --- test-local churn serialisers (hoisted to module scope — oxlint
// consistent-function-scoping: neither function captures anything from an
// enclosing describe/test closure, so hoisting changes nothing about WHEN
// they run or WHAT they register; `TEST_LOCAL_EVIDENCE_SHAPE_SERIALISERS`
// below still builds its Map at the same describe-body evaluation point it
// always did) ---------------------------------------------------------------

// TEST-LOCAL ONLY, for fixture (b) below. The real `EVIDENCE_SHAPE_SERIALISERS`
// map lives in `evidence-shape.ts`, which this sprint may not edit (O-005
// collision contract, ADD C-h) — registering a real version 2 there is out of
// scope. This local map mirrors the exact versioned-map discipline
// `EVIDENCE_SHAPE_SERIALISERS` itself uses, entirely inside this test file, to
// produce a second, DIFFERENT evidence-shape string standing in for "what a
// v2 shape would look like" — the fork is then asserted at the
// `signatureTuple` boundary this file actually owns.
type TestLocalEvidenceShapeV2Input = EvidenceShapeInput & { readonly extraSignalCount: number };

function testLocalSerialiseEvidenceShapeV2(input: TestLocalEvidenceShapeV2Input): string {
  const shape: CanonicalObject = {
    v: 2,
    detector: input.detector,
    surface: input.surface,
    surfaceNormalisationVersion: input.surfaceNormalisationVersion,
    signalKinds: input.signals.map((signal) => signal.kind),
    symptomClass: input.symptomClass,
    extraSignalCount: input.extraSignalCount,
  };
  return canonicalJson(shape);
}

// TEST-LOCAL ONLY, for fixture (e) below. `SIGNATURE_TUPLE_SERIALISERS` in
// `signature-tuple.ts` has only version 1 registered, and this sprint's own
// Wave 0 task may not add a real version 2 (this file writes tests, not
// production code). This local function mirrors EXACTLY what the real v1
// serialiser is documented to do (`canonicalJson({ v, projectId, surfaceId,
// symptomClass, evidenceShape })`), with `v` bumped to 2, entirely inside this
// test file.
function testLocalSignatureTupleV2(input: SignatureTupleInput): string {
  return canonicalJson({
    v: 2,
    projectId: input.projectId,
    surfaceId: input.surfaceId,
    symptomClass: input.symptomClass,
    evidenceShape: input.evidenceShape,
  });
}

// --- W0-5's pinned baseline (probes.md — executed, not assumed) -------------

/**
 * The exact byte-string `probes.md` W0-5 pinned by actually running
 * `evidenceShape` at HEAD `9cb9f49`. If an O-005 rebase changes
 * `canonicalJson`, `normaliseUrlPath`, or `evidence-shape.ts`'s `serialiseV1`,
 * THIS assertion fails first and loudly, before any churn fixture below goes
 * confusingly wrong.
 */
const GOLDEN_EVIDENCE_SHAPE_V1 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_uncorrelated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":2,"symptomClass":"broken","v":1}';

const BASELINE_SURFACE = mustNormalise("/Checkout");
const BASELINE_EVIDENCE_SHAPE = evidenceShape(
  shapeInputWithSurface(BASELINE_SURFACE),
  EVIDENCE_SHAPE_VERSION,
);

/** The one `SignatureTupleInput` this whole file is anchored to. */
const BASELINE_TUPLE_INPUT: SignatureTupleInput = {
  projectId: PROJECT_ID,
  surfaceId: BASELINE_SURFACE,
  symptomClass: "broken",
  evidenceShape: BASELINE_EVIDENCE_SHAPE,
};

/**
 * (h) THE ONE ABSOLUTE GOLDEN LITERAL THIS FILE PINS.
 *
 * Pinned in the implementation wave by actually running
 * `signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)` once
 * (`serialiseV1` is now implemented in `signature-tuple.ts`) and pasting the
 * exact captured output here (same discipline as W0-5's evidence-shape
 * literal in `probes.md`) — never derived by hand from `canonicalJson` in
 * this file, even though the algorithm is knowable: the whole point of a
 * committed literal is that a change to the real serialiser fails HERE,
 * against an independently-obtained value, rather than silently agreeing
 * with itself.
 */
const GOLDEN_V1_TUPLE_BASELINE =
  '{"evidenceShape":"{\\"detector\\":\\"funnel_dropoff\\",\\"signalKinds\\":[\\"failure_uncorrelated\\",\\"struggle\\"],\\"surface\\":\\"/checkout\\",\\"surfaceNormalisationVersion\\":2,\\"symptomClass\\":\\"broken\\",\\"v\\":1}","projectId":"11111111-1111-4111-8111-111111111111","surfaceId":"/checkout","symptomClass":"broken","v":1}';

describe("signature-churn — baseline golden fixtures (W0-5 pin + the one committed tuple literal)", () => {
  test("pins the evidence_shape bytes for the baseline fixture", () => {
    // Pins the OBSERVED constant too — a bump of URL_PATH_NORMALISATION_VERSION
    // away from 2 is itself a churn event (fixture (a) below), and this
    // assertion is what would make that bump visible here first.
    expect(URL_PATH_NORMALISATION_VERSION).toBe(2);
    expect(BASELINE_EVIDENCE_SHAPE).toBe(GOLDEN_EVIDENCE_SHAPE_V1);
  });

  test("pins the v1 signature tuple string for the baseline fixture (golden literal, pinned)", () => {
    // GREEN: `serialiseV1` is implemented and this literal was pinned by
    // actually running the function once.
    expect(signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)).toBe(
      GOLDEN_V1_TUPLE_BASELINE,
    );
  });
});

describe("signature-churn — D12 fork fixtures (relational; independent of any literal)", () => {
  // --- (a) FR-F a ------------------------------------------------------------
  test("forks the identity when URL_PATH_NORMALISATION_VERSION moves 2 to 3, and an ancestry row maps it", () => {
    // The surface ("/checkout") does not change bytes; only the VERSION
    // stamped beside it does — exactly the D-15/FR-18 wire this pins.
    const shapeUnderV2 = evidenceShape(
      { ...shapeInputWithSurface(BASELINE_SURFACE), surfaceNormalisationVersion: 2 },
      EVIDENCE_SHAPE_VERSION,
    );
    const shapeUnderHypotheticalV3 = evidenceShape(
      { ...shapeInputWithSurface(BASELINE_SURFACE), surfaceNormalisationVersion: 3 },
      EVIDENCE_SHAPE_VERSION,
    );

    const tupleUnderV2 = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: BASELINE_SURFACE,
        symptomClass: "broken",
        evidenceShape: shapeUnderV2,
      },
      SIGNATURE_TUPLE_VERSION,
    );
    const tupleUnderV3 = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: BASELINE_SURFACE,
        symptomClass: "broken",
        evidenceShape: shapeUnderHypotheticalV3,
      },
      SIGNATURE_TUPLE_VERSION,
    );

    expect(tupleUnderV2).not.toBe(tupleUnderV3);
    // DELIBERATE, NAMED OUTCOME: a fork. The DB layer's `signature_ancestry`
    // maps the v2 tuple's hash to the v3 tuple's hash with reason
    // `surface_normalisation_version_bump` (ADD D-3) — provable only in
    // `packages/db` (this package cannot hash, D-1).
  });

  // --- (b) FR-F b --------------------------------------------------------------
  //
  // TEST-LOCAL ONLY (serialiser + input type hoisted to module scope above —
  // oxlint consistent-function-scoping). This local map mirrors the exact
  // versioned-map discipline `EVIDENCE_SHAPE_SERIALISERS` itself uses, to
  // produce a second, DIFFERENT evidence-shape string standing in for "what a
  // v2 shape would look like" — the fork is then asserted at the
  // `signatureTuple` boundary this file actually owns.
  const TEST_LOCAL_EVIDENCE_SHAPE_SERIALISERS: ReadonlyMap<
    number,
    (input: TestLocalEvidenceShapeV2Input) => string
  > = new Map([[2, testLocalSerialiseEvidenceShapeV2]]);

  test("forks the identity when EVIDENCE_SHAPE_VERSION moves 1 to 2 via a test-local v2 serialiser, and an ancestry row maps it", () => {
    const v1Shape = evidenceShape(shapeInputWithSurface(BASELINE_SURFACE), EVIDENCE_SHAPE_VERSION);

    const v2Serialiser = TEST_LOCAL_EVIDENCE_SHAPE_SERIALISERS.get(2);
    expect(v2Serialiser).toBeDefined();
    const v2Shape =
      v2Serialiser?.({
        ...shapeInputWithSurface(BASELINE_SURFACE),
        extraSignalCount: shapeInputWithSurface(BASELINE_SURFACE).signals.length,
      }) ?? "";

    const tupleV1Shape = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: BASELINE_SURFACE,
        symptomClass: "broken",
        evidenceShape: v1Shape,
      },
      SIGNATURE_TUPLE_VERSION,
    );
    const tupleV2Shape = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: BASELINE_SURFACE,
        symptomClass: "broken",
        evidenceShape: v2Shape,
      },
      SIGNATURE_TUPLE_VERSION,
    );

    expect(tupleV1Shape).not.toBe(tupleV2Shape);
    // DELIBERATE, NAMED OUTCOME: a fork, mapped by a `signature_ancestry` row
    // with reason `evidence_shape_version_bump` (ADD D-3) — DB-layer only.
  });

  // --- (c) FR-F c ----------------------------------------------------------
  test("forks the identity on a surface rename from /checkout to /pay, and the dismissal still suppresses through ancestry", () => {
    const checkoutSurface = mustNormalise("/checkout");
    const paySurface = mustNormalise("/pay");

    const checkoutShape = evidenceShape(
      shapeInputWithSurface(checkoutSurface),
      EVIDENCE_SHAPE_VERSION,
    );
    const payShape = evidenceShape(shapeInputWithSurface(paySurface), EVIDENCE_SHAPE_VERSION);

    const checkoutTuple = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: checkoutSurface,
        symptomClass: "broken",
        evidenceShape: checkoutShape,
      },
      SIGNATURE_TUPLE_VERSION,
    );
    const payTuple = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: paySurface,
        symptomClass: "broken",
        evidenceShape: payShape,
      },
      SIGNATURE_TUPLE_VERSION,
    );

    expect(checkoutTuple).not.toBe(payTuple);
    // THE EXACT CASE THE FUTURE TS-MORPH SWAP MUST ABSORB (M1). The DB half —
    // a dismissal recorded against `checkoutTuple`'s hash still suppresses
    // `payTuple`'s hash once a `signature_ancestry` row maps
    // old → new with reason `surface_rename` — is T-DB-7, in `packages/db`.
    // This package can only prove the fork is real; it cannot prove the
    // dismissal survives it (no hashing, no ledger, D-1).
  });

  // --- (d) FR-F d / OQ-7 -----------------------------------------------------
  test("treats O-005's per-origin funnel aggregation change as a zero-cost fork because no ledger row predates it", () => {
    // DELIBERATE, NAMED DECISION (not discovered later): a concurrent O-005
    // sprint is changing what "surface" means for the funnel detector — from
    // a specific step path to an origin-aggregated bucket. The chosen outcome
    // here is a FORK, exactly like any other surfaceId change (D-6's "some
    // fork, some don't" asymmetry: a surface value change is always identity,
    // never magnitude). It is deliberately NOT mapped by a `signature_ancestry`
    // row: ancestry is EMPTY in production at MVP (ADD D-3 "Consequence for
    // MVP") — nothing has written a ledger row against the per-step surface
    // before this aggregation change ships, so there is nothing to migrate,
    // and the fork costs nothing.
    const perStepSurface = mustNormalise("/checkout/step-1");
    const perOriginSurface = mustNormalise("/checkout");

    const perStepShape = evidenceShape(
      shapeInputWithSurface(perStepSurface),
      EVIDENCE_SHAPE_VERSION,
    );
    const perOriginShape = evidenceShape(
      shapeInputWithSurface(perOriginSurface),
      EVIDENCE_SHAPE_VERSION,
    );

    const perStepTuple = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: perStepSurface,
        symptomClass: "broken",
        evidenceShape: perStepShape,
      },
      SIGNATURE_TUPLE_VERSION,
    );
    const perOriginTuple = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: perOriginSurface,
        symptomClass: "broken",
        evidenceShape: perOriginShape,
      },
      SIGNATURE_TUPLE_VERSION,
    );

    expect(perStepTuple).not.toBe(perOriginTuple);
    // No ancestry row is asserted here — deliberately. There is nothing to map.
  });

  // --- (e) FR-F e (the only cuttable fixture) ---------------------------------
  //
  // TEST-LOCAL ONLY (function hoisted to module scope above — oxlint
  // consistent-function-scoping), same reasoning as (b): `SIGNATURE_TUPLE_SERIALISERS`
  // in `signature-tuple.ts` has only version 1 registered, and this sprint's
  // own Wave 0 task may not add a real version 2 (this file writes tests, not
  // production code).
  test("forks the identity (produces a different tuple string) when SIGNATURE_TUPLE_VERSION is bumped", () => {
    const v1Tuple = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);
    const v2Tuple = testLocalSignatureTupleV2(BASELINE_TUPLE_INPUT);

    expect(v1Tuple).not.toBe(v2Tuple);
  });
});

describe("signature-churn — negative control and anti-vacuity control", () => {
  // --- (f) FR-F f --------------------------------------------------------------
  test("produces the same tuple string for the same inputs twice — NECESSARY BUT INSUFFICIENT", () => {
    // NECESSARY BUT INSUFFICIENT. This proves `signatureTuple` is at least
    // deterministic for one fixed input. It does NOT prove the identity is
    // STABLE ACROSS CHURN, and it does NOT prove the function reads its
    // input at all: a function that ignores every argument and always
    // returns one constant string would pass this test (and would pass it
    // twice, and a hundred times) while failing every fork fixture above and
    // the anti-vacuity fork below. D12's own words: "'same input twice'
    // proves nothing here." This test is included because the ADD requires
    // it named explicitly, not because it carries D12 content on its own.
    const first = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);
    const second = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);

    expect(first).toBe(second);
    expect(first).toBe(GOLDEN_V1_TUPLE_BASELINE);
  });

  // --- (g) FR-F g — ANTI-VACUITY, NOT OPTIONAL --------------------------------
  test("ANTI-VACUITY: forks the identity (produces a different tuple string) when symptom_class flips broken to confusing", () => {
    // WITHOUT THIS TEST, a `signatureTuple` implementation that always
    // returns a fixed constant string would pass the negative control above
    // (same input, same constant, twice) and could ALSO be made to "pass" the
    // fork fixtures above by accident if nobody checked that the two sides of
    // each fork fixture actually differ in the field under test. This test
    // holds `projectId`, `surfaceId`, and `evidenceShape` completely fixed —
    // the SAME `BASELINE_TUPLE_INPUT` — and varies ONLY `symptomClass`, which
    // isolates `signatureTuple`'s OWN field (distinct from whatever
    // `symptomClass` value happens to already be embedded inside
    // `evidenceShape`'s string — D-5's deliberate redundancy).
    const brokenTuple = signatureTuple(
      { ...BASELINE_TUPLE_INPUT, symptomClass: "broken" },
      SIGNATURE_TUPLE_VERSION,
    );
    const confusingTuple = signatureTuple(
      { ...BASELINE_TUPLE_INPUT, symptomClass: "confusing" },
      SIGNATURE_TUPLE_VERSION,
    );

    expect(brokenTuple).not.toBe(confusingTuple);
  });
});

describe("signature-churn — ESC-10: thresholdRuleSetVersion is not an identity input (FR-M)", () => {
  /**
   * `thresholdRuleSetVersion` does not exist on `SignatureTupleInput` at all
   * (D-6) — the allowlist is STRUCTURAL, not a convention. This local type
   * models a caller who has one anyway (e.g. a `CandidateFinding`-shaped
   * value carrying `thresholdRuleSetVersion`) and passes it through — the
   * `InputWithIgnoredFields` pattern `evidence-shape.test.ts` already uses.
   * Because `signatureTuple`'s parameter type is exactly `SignatureTupleInput`,
   * it structurally cannot read the extra field no matter what a future
   * `CandidateFinding` grows.
   */
  type InputWithIgnoredThresholdVersion = SignatureTupleInput & {
    readonly thresholdRuleSetVersion?: number;
  };

  // --- FR-M a ------------------------------------------------------------
  test("produces an identical tuple string for two candidates differing only in thresholdRuleSetVersion", () => {
    const underV1Rules: InputWithIgnoredThresholdVersion = {
      ...BASELINE_TUPLE_INPUT,
      thresholdRuleSetVersion: 1,
    };
    const underV7Rules: InputWithIgnoredThresholdVersion = {
      ...BASELINE_TUPLE_INPUT,
      thresholdRuleSetVersion: 7,
    };

    const tupleUnderV1Rules = signatureTuple(underV1Rules, SIGNATURE_TUPLE_VERSION);
    const tupleUnderV7Rules = signatureTuple(underV7Rules, SIGNATURE_TUPLE_VERSION);

    // Structural, not observed: a threshold tweak must NEVER fork every
    // signature on record (D-6) — the catastrophe D12 exists to prevent.
    expect(tupleUnderV1Rules).toBe(tupleUnderV7Rules);
  });

  // --- FR-M b (the should-fork sibling that makes FR-M a mean something) ----
  test("produces a different tuple string for two candidates differing only in finalClass", () => {
    const brokenCandidate: InputWithIgnoredThresholdVersion = {
      ...BASELINE_TUPLE_INPUT,
      thresholdRuleSetVersion: 1,
      symptomClass: "broken",
    };
    const confusingCandidate: InputWithIgnoredThresholdVersion = {
      ...BASELINE_TUPLE_INPUT,
      thresholdRuleSetVersion: 1,
      symptomClass: "confusing",
    };

    const brokenTuple = signatureTuple(brokenCandidate, SIGNATURE_TUPLE_VERSION);
    const confusingTuple = signatureTuple(confusingCandidate, SIGNATURE_TUPLE_VERSION);

    // Without this sibling, FR-M a would be indistinguishable from a
    // `signatureTuple` that ignores EVERY field, not just
    // `thresholdRuleSetVersion` — the same anti-vacuity concern as (g), aimed
    // at the "some fork, some don't" asymmetry D-6 specifically claims.
    expect(brokenTuple).not.toBe(confusingTuple);
  });
});
