// "Golden-fixture tests, churn" (Wave 0, never cut).
//
// This file is the direct proof of the fourth definition-of-done clause: "a
// golden-fixture test proves signature stability across surface churn, with surfaces as
// URL paths, so the later ts-morph swap is absorbed by ancestry rather than a re-key."
//
// The one thing this file cannot do, and why
//
// `packages/core` cannot import `sha256Hex`. It lives in `packages/db`, and `core → db`
// is forbidden, including from a test file (a test importing a workspace package
// outside its own package's dependency graph is the same layering violation with a
// different excuse). So every assertion below compares `signatureTuple`'s output
// strings, never a hex digest. This is the correct unit boundary, not a workaround:
// `sha256Hex` is a pure deterministic function of its input string, so a difference in
// the tuple string is exactly a difference in the digest, and `packages/core` is the
// package that owns the tuple string. The one real hex digest this sprint pins is
// T-DB-6, in `packages/db/__tests__/services/signature-ledger.service.test.ts`.
//
// Wave 1 implementation status
//
// `signatureTuple`'s v1 serialiser body is now implemented
// (`packages/core/src/findings/signature-tuple.ts`), and every test below is green.
// `GOLDEN_V1_TUPLE_BASELINE` was pinned by actually running
// `signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)` once and capturing
// its exact output (the discipline, `probes.md`), never guessed, never derived by hand
// from `canonicalJson` in this file.
//
// Two kinds of assertion appear below (the own split): relational fork / no-fork
// assertions. The real content, and
//  independent of any literal. These compare two outputs of the same
//  real `signatureTuple` call to each other.
//  One absolute golden literal, `GOLDEN_V1_TUPLE_BASELINE`, pinned to
//  the byte-string actually produced by `signatureTuple`.
//
// Every fixture surface/name below is synthetic (`/checkout`, `/pay`,
// `acme.example`-style placeholders never appear). This repository is public (no real
// customer data, no strategy, no personas).
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

// -- fixture time (no Date.now anywhere in this file, per house rules)

const FIXED_AT = new Date("2026-06-01T10:00:00.000Z");
const FIXED_WINDOW_END = new Date("2026-06-08T10:00:00.000Z");

// A synthetic project id. A randomUUID-shaped literal, never real data

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

// -- fixture helpers

/** `evidenceShape`'s serialiser refuses an un-normalised surface. Build every fixture
 * surface through the real function, never as a hand-typed literal (mirrors
 * `evidence-shape.test.ts`'s `normalisedSurface`). */
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
 * The evidence-shape input for a given surface, holding everything else fixed. Two
 * struggle signals + one uncorrelated failure, in this exact order, so `signalKinds`
 * sorts+dedupes to `["failure_uncorrelated", "struggle"]`. Matching the pinned fixture
 * exactly when `surface` is `/checkout`.
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

// test-local churn serialisers (hoisted to module scope. Oxlint.
// consistent-function-scoping: neither function captures anything from an enclosing
// describe/test closure, so hoisting changes nothing about when they run or what they
// register; `TEST_LOCAL_EVIDENCE_SHAPE_SERIALISERS` below still builds its Map at the
// same describe-body evaluation point it
// always did)

// Test-local only, for fixture below. The real `EVIDENCE_SHAPE_SERIALISERS` map
// lives in `evidence-shape.ts`, which this sprint may not edit (collision contract, add
// c-h). Registering a real version 2 there is out of scope. This local map mirrors the
// exact versioned-map discipline `EVIDENCE_SHAPE_SERIALISERS` itself uses, entirely
// inside this test file, to produce a second, different evidence-shape string standing
// in for "what a v2 shape would look like". The fork is then asserted at the
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

// Test-local only, for fixture below. `SIGNATURE_TUPLE_SERIALISERS` in
// `signature-tuple.ts` has only version 1 registered, and this sprint's own Wave 0 task
// may not add a real version 2 (this file writes tests, not production code). This
// local function mirrors exactly what the real v1 serialiser is documented to do
// (`canonicalJson({ v, projectId, surfaceId, symptomClass, evidenceShape })`), with `v`
// bumped to 2, entirely inside this test file.
function testLocalSignatureTupleV2(input: SignatureTupleInput): string {
  return canonicalJson({
    v: 2,
    projectId: input.projectId,
    surfaceId: input.surfaceId,
    symptomClass: input.symptomClass,
    evidenceShape: input.evidenceShape,
  });
}

// -- the pinned baseline (probes.md. Executed, not assumed)

/**
 * The exact byte-string `probes.md` pinned by actually running `evidenceShape` at HEAD
 * `9cb9f49`. If an rebase changes `canonicalJson`, `normaliseUrlPath`, or
 * `evidence-shape.ts`'s `serialiseV1`, this assertion fails first and loudly, before
 * any churn fixture below goes confusingly wrong.
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
 *  the one absolute golden literal this file pins.
 *
 * Pinned in the implementation wave by actually running
 * `signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)` once (`serialiseV1`
 * is now implemented in `signature-tuple.ts`) and pasting the exact captured output
 * here (same discipline as the evidence-shape literal in `probes.md`), never derived by
 * hand from `canonicalJson` in this file, even though the algorithm is knowable: the
 * whole point of a committed literal is that a change to the real serialiser fails
 * here, against an independently-obtained value, rather than silently agreeing with
 * itself.
 */
const GOLDEN_V1_TUPLE_BASELINE =
  '{"evidenceShape":"{\\"detector\\":\\"funnel_dropoff\\",\\"signalKinds\\":[\\"failure_uncorrelated\\",\\"struggle\\"],\\"surface\\":\\"/checkout\\",\\"surfaceNormalisationVersion\\":2,\\"symptomClass\\":\\"broken\\",\\"v\\":1}","projectId":"11111111-1111-4111-8111-111111111111","surfaceId":"/checkout","symptomClass":"broken","v":1}';

describe("signature-churn — baseline golden fixtures (W0-5 pin + the one committed tuple literal)", () => {
  test("pins the evidence_shape bytes for the baseline fixture", () => {
    // Pins the observed constant too. A bump of URL_PATH_NORMALISATION_VERSION away
    // from 2 is itself a churn event (fixture below), and this assertion is what
    // would make that bump visible here first.
    expect(URL_PATH_NORMALISATION_VERSION).toBe(2);
    expect(BASELINE_EVIDENCE_SHAPE).toBe(GOLDEN_EVIDENCE_SHAPE_V1);
  });

  test("pins the v1 signature tuple string for the baseline fixture (golden literal, pinned)", () => {
    // Green: `serialiseV1` is implemented and this literal was pinned by actually
    // running the function once.
    expect(signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)).toBe(
      GOLDEN_V1_TUPLE_BASELINE,
    );
  });
});

describe("signature-churn — fork fixtures (relational; independent of any literal)", () => {
  // -- fr-f a
  test("forks the identity when URL_PATH_NORMALISATION_VERSION moves 2 to 3, and an ancestry row maps it", () => {
    // The surface ("/checkout") does not change bytes; only the version stamped beside
    // it does. Exactly the / wire this pins.
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
    // Deliberate, named outcome: a fork. The DB layer's `signature_ancestry` maps the
    // v2 tuple's hash to the v3 tuple's hash with reason
    // `surface_normalisation_version_bump`. Provable only in `packages/db` (this
    // package cannot hash).
  });

  // -- fr-f b
  //
  // Test-local only (serialiser + input type hoisted to module scope above. Oxlint
  // consistent-function-scoping). This local map mirrors the exact versioned-map
  // discipline `EVIDENCE_SHAPE_SERIALISERS` itself uses, to produce a second, different
  // evidence-shape string standing in for "what a v2 shape would look like". The fork
  // is then asserted at the `signatureTuple` boundary this file actually owns.
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
    // Deliberate, named outcome: a fork, mapped by a `signature_ancestry` row with
    // reason `evidence_shape_version_bump`, DB-layer only.
  });

  // -- fr-f c
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
    // The exact case the future ts-morph swap must absorb. The DB half, a
    // dismissal recorded against `checkoutTuple`'s hash still suppresses `payTuple`'s
    // hash once a `signature_ancestry` row maps old → new with reason `surface_rename`.
    // Is T-DB-7, in `packages/db`. This package can only prove the fork is real; it
    // cannot prove the dismissal survives it (no hashing, no ledger).
  });

  // -- fr-f d / OQ-7
  test("treats 's per-origin funnel aggregation change as a zero-cost fork because no ledger row predates it", () => {
    // Deliberate, named decision (not discovered later): a concurrent sprint is
    // changing what "surface" means for the funnel detector. From a specific step path
    // to an origin-aggregated bucket. The chosen outcome here is a fork, exactly like
    // any other surfaceId change (the "some fork, some don't" asymmetry: a surface
    // value change is always identity, never magnitude). It is deliberately not mapped
    // by a `signature_ancestry` row: ancestry is empty in production at MVP (add
    // "Consequence for MVP"). Nothing has written a ledger row against the per-step
    // surface before this aggregation change ships, so there is nothing to migrate, and
    // the fork costs nothing.
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
    // No ancestry row is asserted here. Deliberately. There is nothing to map.
  });

  // -- fr-f e (the only cuttable fixture)
  //
  // Test-local only (function hoisted to module scope above. Oxlint
  // consistent-function-scoping), same reasoning as: `SIGNATURE_TUPLE_SERIALISERS`
  // in `signature-tuple.ts` has only version 1 registered, and this sprint's own Wave 0
  // task may not add a real version 2 (this file writes tests, not production code).
  test("forks the identity (produces a different tuple string) when SIGNATURE_TUPLE_VERSION is bumped", () => {
    const v1Tuple = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);
    const v2Tuple = testLocalSignatureTupleV2(BASELINE_TUPLE_INPUT);

    expect(v1Tuple).not.toBe(v2Tuple);
  });
});

describe("signature-churn — negative control and anti-vacuity control", () => {
  // -- fr-f f
  test("produces the same tuple string for the same inputs twice — NECESSARY BUT INSUFFICIENT", () => {
    // Necessary but insufficient. This proves `signatureTuple` is at least
    // deterministic for one fixed input. It does not prove the identity is stable
    // across churn, and it does not prove the function reads its input at all: a
    // function that ignores every argument and always returns one constant string would
    // pass this test (and would pass it twice, and a hundred times) while failing every
    // fork fixture above and the anti-vacuity fork below. the own words: "'same input
    // twice' proves nothing here." This test is included because the add requires it
    // named explicitly, not because it carries content on its own.
    const first = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);
    const second = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);

    expect(first).toBe(second);
    expect(first).toBe(GOLDEN_V1_TUPLE_BASELINE);
  });

  // -- fr-f g. Anti-vacuity, not optional
  test("ANTI-VACUITY: forks the identity (produces a different tuple string) when symptom_class flips broken to confusing", () => {
    // Without this test, a `signatureTuple` implementation that always returns a fixed
    // constant string would pass the negative control above (same input, same constant,
    // twice) and could also be made to "pass" the fork fixtures above by accident if
    // nobody checked that the two sides of each fork fixture actually differ in the
    // field under test. This test holds `projectId`, `surfaceId`, and `evidenceShape`
    // completely fixed (the same `BASELINE_TUPLE_INPUT`) and varies only
    // `symptomClass`, which isolates `signatureTuple`'s own field (distinct from
    // whatever `symptomClass` value happens to already be embedded inside
    // `evidenceShape`'s string. The deliberate redundancy).
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

describe("signature-churn —: thresholdRuleSetVersion is not an identity input (FR-M)", () => {
  /**
   * `thresholdRuleSetVersion` does not exist on `SignatureTupleInput` at all. The
   * allowlist is structural, not a convention. This local type models a caller who has
   * one anyway (e.g. a `CandidateFinding`-shaped value carrying
   * `thresholdRuleSetVersion`) and passes it through. The `InputWithIgnoredFields`
   * pattern `evidence-shape.test.ts` already uses. Because `signatureTuple`'s parameter
   * type is exactly `SignatureTupleInput`, it structurally cannot read the extra field
   * no matter what a future `CandidateFinding` grows.
   */
  type InputWithIgnoredThresholdVersion = SignatureTupleInput & {
    readonly thresholdRuleSetVersion?: number;
  };

  // -- fr-m a
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

    // Structural, not observed: a threshold tweak must never fork every signature on
    // record. The catastrophe exists to prevent.
    expect(tupleUnderV1Rules).toBe(tupleUnderV7Rules);
  });

  // -- fr-m b (the should-fork sibling that makes fr-m a mean something)
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

    // Without this sibling, fr-m a would be indistinguishable from a `signatureTuple`
    // that ignores every field, not just `thresholdRuleSetVersion`, the same
    // anti-vacuity concern as, aimed at the "some fork, some don't" asymmetry
    // specifically claims.
    expect(brokenTuple).not.toBe(confusingTuple);
  });
});
