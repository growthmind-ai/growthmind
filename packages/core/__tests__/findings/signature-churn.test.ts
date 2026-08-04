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

const FIXED_AT = new Date("2026-06-01T10:00:00.000Z");
const FIXED_WINDOW_END = new Date("2026-06-08T10:00:00.000Z");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

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

function shapeInputWithSurface(surface: string): EvidenceShapeInput {
  return {
    detector: "funnel_dropoff",
    surface,
    surfaceNormalisationVersion: URL_PATH_NORMALISATION_VERSION,
    signals: [struggleSignal(surface), failureUncorrelatedSignal(), struggleSignal(surface)],
    symptomClass: "broken",
  };
}

type TestLocalEvidenceShapeV3Input = EvidenceShapeInput & { readonly extraSignalCount: number };

// A hypothetical NEXT version. It was written as `v2` when v2 did not exist; v2 is now the real
// current serialiser (B-016), so the shim moves up one to keep testing what it was for — that a
// shape-version bump forks identity and ancestry maps it.
function testLocalSerialiseEvidenceShapeV3(input: TestLocalEvidenceShapeV3Input): string {
  const shape: CanonicalObject = {
    v: 3,
    detector: input.detector,
    surface: input.surface,
    surfaceNormalisationVersion: input.surfaceNormalisationVersion,
    signalKinds: input.signals.map((signal) => signal.kind),
    symptomClass: input.symptomClass,
    extraSignalCount: input.extraSignalCount,
  };
  return canonicalJson(shape);
}

function testLocalSignatureTupleV2(input: SignatureTupleInput): string {
  return canonicalJson({
    v: 2,
    projectId: input.projectId,
    surfaceId: input.surfaceId,
    symptomClass: input.symptomClass,
    evidenceShape: input.evidenceShape,
  });
}

const GOLDEN_EVIDENCE_SHAPE_V1 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_uncorrelated","struggle"],' +
  '"surface":"/checkout","surfaceNormalisationVersion":2,"symptomClass":"broken","v":1}';

const GOLDEN_EVIDENCE_SHAPE_V2 =
  '{"detector":"funnel_dropoff","signalKinds":["failure_uncorrelated","struggle"],' +
  '"surface":"/checkout","symptomClass":"broken","v":2}';

const BASELINE_SURFACE = mustNormalise("/Checkout");
const BASELINE_EVIDENCE_SHAPE = evidenceShape(
  shapeInputWithSurface(BASELINE_SURFACE),
  EVIDENCE_SHAPE_VERSION,
);
const BASELINE_EVIDENCE_SHAPE_AT_V1 = evidenceShape(shapeInputWithSurface(BASELINE_SURFACE), 1);

const BASELINE_TUPLE_INPUT: SignatureTupleInput = {
  projectId: PROJECT_ID,
  surfaceId: BASELINE_SURFACE,
  symptomClass: "broken",
  evidenceShape: BASELINE_EVIDENCE_SHAPE,
};

const GOLDEN_V1_TUPLE_BASELINE =
  '{"evidenceShape":"{\\"detector\\":\\"funnel_dropoff\\",\\"signalKinds\\":[\\"failure_uncorrelated\\",\\"struggle\\"],\\"surface\\":\\"/checkout\\",\\"surfaceNormalisationVersion\\":2,\\"symptomClass\\":\\"broken\\",\\"v\\":1}","projectId":"11111111-1111-4111-8111-111111111111","surfaceId":"/checkout","symptomClass":"broken","v":1}';

const GOLDEN_TUPLE_BASELINE =
  '{"evidenceShape":"{\\"detector\\":\\"funnel_dropoff\\",\\"signalKinds\\":[\\"failure_uncorrelated\\",\\"struggle\\"],\\"surface\\":\\"/checkout\\",\\"symptomClass\\":\\"broken\\",\\"v\\":2}","projectId":"11111111-1111-4111-8111-111111111111","surfaceId":"/checkout","symptomClass":"broken","v":1}';

describe("signature-churn — baseline golden fixtures (W0-5 pin + the one committed tuple literal)", () => {
  test("pins the evidence_shape bytes for the baseline fixture", () => {
    expect(URL_PATH_NORMALISATION_VERSION).toBe(2);
    expect(BASELINE_EVIDENCE_SHAPE).toBe(GOLDEN_EVIDENCE_SHAPE_V2);

    // The retired serialiser keeps reproducing its own bytes, so a stored v1 row stays attached.
    expect(BASELINE_EVIDENCE_SHAPE_AT_V1).toBe(GOLDEN_EVIDENCE_SHAPE_V1);
  });

  test("pins the signature tuple string for the baseline fixture (golden literal, pinned)", () => {
    expect(signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION)).toBe(
      GOLDEN_TUPLE_BASELINE,
    );

    // The v1-era tuple, still reproducible from a v1 shape.
    expect(
      signatureTuple(
        { ...BASELINE_TUPLE_INPUT, evidenceShape: BASELINE_EVIDENCE_SHAPE_AT_V1 },
        SIGNATURE_TUPLE_VERSION,
      ),
    ).toBe(GOLDEN_V1_TUPLE_BASELINE);
  });
});

describe("signature-churn — fork fixtures (relational; independent of any literal)", () => {
  test("holds one identity when URL_PATH_NORMALISATION_VERSION moves 2 to 3 (B-016)", () => {
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

    // Was a deliberate fork, and was wrong: the version is derived per-window and goes null
    // the moment the events on a surface disagree, so an ordinary rollout walked every surface
    // 2 → null → 3 and minted three identities for one problem. It is provenance now, not
    // identity, and no ancestry row is owed for a bump that no longer forks anything.
    expect(tupleUnderV2).toBe(tupleUnderV3);

    const tupleMidRollout = signatureTuple(
      {
        projectId: PROJECT_ID,
        surfaceId: BASELINE_SURFACE,
        symptomClass: "broken",
        evidenceShape: evidenceShape(
          { ...shapeInputWithSurface(BASELINE_SURFACE), surfaceNormalisationVersion: null },
          EVIDENCE_SHAPE_VERSION,
        ),
      },
      SIGNATURE_TUPLE_VERSION,
    );
    expect(tupleMidRollout).toBe(tupleUnderV2);
  });

  const TEST_LOCAL_EVIDENCE_SHAPE_SERIALISERS: ReadonlyMap<
    number,
    (input: TestLocalEvidenceShapeV3Input) => string
  > = new Map([[2, testLocalSerialiseEvidenceShapeV3]]);

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

  test("treats 's per-origin funnel aggregation change as a zero-cost fork because no ledger row predates it", () => {
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

  test("forks the identity (produces a different tuple string) when SIGNATURE_TUPLE_VERSION is bumped", () => {
    const v1Tuple = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);
    const v2Tuple = testLocalSignatureTupleV2(BASELINE_TUPLE_INPUT);

    expect(v1Tuple).not.toBe(v2Tuple);
  });
});

describe("signature-churn — negative control and anti-vacuity control", () => {
  test("produces the same tuple string for the same inputs twice — NECESSARY BUT INSUFFICIENT", () => {
    const first = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);
    const second = signatureTuple(BASELINE_TUPLE_INPUT, SIGNATURE_TUPLE_VERSION);

    expect(first).toBe(second);
    expect(first).toBe(GOLDEN_TUPLE_BASELINE);
  });

  test("ANTI-VACUITY: forks the identity (produces a different tuple string) when symptom_class flips broken to confusing", () => {
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
  type InputWithIgnoredThresholdVersion = SignatureTupleInput & {
    readonly thresholdRuleSetVersion?: number;
  };

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

    expect(tupleUnderV1Rules).toBe(tupleUnderV7Rules);
  });

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

    expect(brokenTuple).not.toBe(confusingTuple);
  });
});
