// ADD §7 "Unit tests — `packages/core`" — the named tests for
// `signatureTuple` (O-006, ADD §2 D-1, D-5, D-6; §5 Wave 2).
//
// This is a Wave 0 TDD contract task: `signatureTuple` and `serialiseV1`
// still throw `not implemented`. Every assertion below is written against the
// FINAL exported contract in `signature-tuple.ts`, so this suite must
// typecheck cleanly today and fail red until a later wave fills the bodies
// in.
//
// What this file pins:
//   1. v1 is FROZEN — it must emit the literal `1`, never read
//      `SIGNATURE_TUPLE_VERSION` (D12: a later bump must not reach back and
//      rewrite every v1 identity on record).
//   2. Dispatch is BY VERSION, through the map — an unregistered version
//      THROWS rather than silently falling back to "current" (D-6 fail
//      direction: refuse).
//   3. The tuple string is produced through `canonicalJson` and ONLY
//      `canonicalJson` — no second definition of "canonical" anywhere in
//      this module (D-13 precedent).
//   4. FR-M / ESC-10's load-bearing pair: `thresholdRuleSetVersion` is not
//      an identity input at all (two inputs differing only in it collapse to
//      one tuple string), and its anti-vacuity sibling — `symptomClass` IS
//      an identity input (two inputs differing only in it fork).
//   5. A `null` `surfaceNormalisationVersion`, arriving through the real
//      `evidenceShape()` input path, serialises deterministically and does
//      not throw.
//
// No clock and no randomness anywhere in this file — every fixture is a
// literal.
import { describe, expect, mock, test } from "bun:test";

import { evidenceShape } from "../../src/findings/evidence-shape";
import type { EvidenceShapeInput } from "../../src/findings/evidence-shape";
import * as signatureTupleModule from "../../src/findings/signature-tuple";
import {
  SIGNATURE_TUPLE_SERIALISERS,
  signatureTuple,
} from "../../src/findings/signature-tuple";
import type { SignatureTupleInput } from "../../src/findings/signature-tuple";
import { canonicalJson } from "../../src/serialise/canonical-json";

// ── fixtures ──────────────────────────────────────────────────────────────

/** A `randomUUID`-shaped literal — `SignatureTupleInput.projectId` is never
 * re-derived, so any fixed string stands in fine. */
const PROJECT_ID = "b3d43e3f-8f2a-4b8b-9a4b-1d9d9a8f5b21";
/** Already a `normaliseUrlPath` fixed point — this module does NOT
 * re-normalise (D-5), so a fixture that were NOT normalised would prove
 * nothing about `signatureTuple` itself. */
const SURFACE = "/checkout";

/**
 * A real `evidence_shape` string, produced through the actual (already
 * IMPLEMENTED, non-scaffold) `evidenceShape()` serialiser — never a
 * hand-written JSON literal masquerading as one. `signatureTuple` treats this
 * as an opaque string; building it through the real function is what proves
 * the two modules actually compose.
 */
function fixtureEvidenceShape(overrides: Partial<EvidenceShapeInput> = {}): string {
  return evidenceShape(
    {
      detector: "funnel_dropoff",
      surface: SURFACE,
      surfaceNormalisationVersion: 2,
      signals: [],
      symptomClass: "broken",
      ...overrides,
    },
    1,
  );
}

/** An input plus arbitrary extra keys — the vehicle for FR-M(a)'s
 * "differing only in `thresholdRuleSetVersion`" fixture. `SignatureTupleInput`
 * has no such field (D-6): the intersection is what lets a test hand one in
 * anyway without weakening the allowlist type itself. */
type InputWithIgnoredField = SignatureTupleInput & { readonly [ignored: string]: unknown };

function baseInput(overrides: Partial<SignatureTupleInput> = {}): SignatureTupleInput {
  return {
    projectId: PROJECT_ID,
    surfaceId: SURFACE,
    symptomClass: "broken",
    evidenceShape: fixtureEvidenceShape(),
    ...overrides,
  };
}

describe("signatureTuple — the v1 serialiser is frozen (FR-A b, D12)", () => {
  test("should emit a literal v1 and never the current version constant", async () => {
    // Prove the frozen-literal claim FOR REAL rather than by convention:
    // re-import the module with `SIGNATURE_TUPLE_VERSION` stubbed far ahead
    // of 1. `serialiseV1` must hardcode the literal `1`
    // (`evidence-shape.ts:116-119` precedent) — if it read the mutable
    // constant instead, this stubbed import's v1 map entry would emit
    // `"v":99`, forking every v1 identity on record the moment the constant
    // ever moves (D12). The real, unmocked module was already captured by
    // the static `import * as signatureTupleModule` above, before this call
    // registers the mock, so spreading it here cannot recurse back into the
    // mock.
    mock.module("../../src/findings/signature-tuple", () => ({
      ...signatureTupleModule,
      SIGNATURE_TUPLE_VERSION: 99,
    }));

    try {
      const stubbed = (await import(
        "../../src/findings/signature-tuple"
      )) as typeof signatureTupleModule;
      expect(stubbed.SIGNATURE_TUPLE_VERSION).toBe(99); // the stub actually took effect

      const v1 = stubbed.SIGNATURE_TUPLE_SERIALISERS.get(1);
      expect(v1).toBeDefined();
      const output = v1!(baseInput());

      expect(output).toContain('"v":1');
      // ANTI-VACUITY: had the frozen serialiser read the (now-stubbed)
      // "current" constant instead of hardcoding `1`, this would be `"v":99`.
      expect(output).not.toContain('"v":99');
    } finally {
      // Restore the real module for every other import in this test run —
      // no other test in this file re-imports dynamically, but a lingering
      // stub is exactly the kind of cross-file leak this suite must not risk.
      mock.module("../../src/findings/signature-tuple", () => signatureTupleModule);
    }
  });

  test("should dispatch by version through the map", () => {
    const viaMap = SIGNATURE_TUPLE_SERIALISERS.get(1);
    expect(viaMap).toBeDefined();
    expect(viaMap!(baseInput())).toBe(signatureTuple(baseInput(), 1));
  });

  test("should throw for an unregistered tuple version rather than falling back to current", () => {
    expect(SIGNATURE_TUPLE_SERIALISERS.get(2)).toBeUndefined();
    expect(() => signatureTuple(baseInput(), 2)).toThrow(/version/i);
  });
});

describe("signatureTuple — no second definition of canonical (D-13)", () => {
  test("should produce the tuple string through canonicalJson with no second canonical definition", () => {
    const input = baseInput();

    const expected = canonicalJson({
      v: 1,
      projectId: input.projectId,
      surfaceId: input.surfaceId,
      symptomClass: input.symptomClass,
      evidenceShape: input.evidenceShape,
    });

    expect(signatureTuple(input, 1)).toBe(expected);

    // Key order is LEXICOGRAPHIC BY CODE UNIT — `canonicalJson`'s guarantee,
    // not something `signatureTuple` orders itself. Extracted keys must
    // already be in sorted order in the output.
    const keysInOutput = [...signatureTuple(input, 1).matchAll(/"([a-zA-Z]+)":/g)].map(
      (match) => match[1] as string,
    );
    expect(keysInOutput.length).toBeGreaterThan(0);
    const sortedKeys = keysInOutput.toSorted((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    expect(keysInOutput).toEqual(sortedKeys);
  });

  test("should serialise a null surfaceNormalisationVersion deterministically without throwing", () => {
    // The null case travels through the REAL evidence-shape input path
    // (D5) — a row written before versions were recorded — rather than a
    // hand-rolled string standing in for it.
    const evidenceShapeWithNullVersion = evidenceShape(
      {
        detector: "funnel_dropoff",
        surface: SURFACE,
        surfaceNormalisationVersion: null,
        signals: [],
        symptomClass: "broken",
      },
      1,
    );
    expect(evidenceShapeWithNullVersion).toContain('"surfaceNormalisationVersion":null');

    const input = baseInput({ evidenceShape: evidenceShapeWithNullVersion });

    const expected = canonicalJson({
      v: 1,
      projectId: input.projectId,
      surfaceId: input.surfaceId,
      symptomClass: input.symptomClass,
      evidenceShape: input.evidenceShape,
    });

    expect(() => signatureTuple(input, 1)).not.toThrow();
    expect(signatureTuple(input, 1)).toBe(expected);
    // Deterministic: the same literal input twice, byte-identical output.
    expect(signatureTuple(input, 1)).toBe(signatureTuple(input, 1));
  });
});

describe("signatureTuple — ESC-10 closed NO, both halves of the pair (D-6, FR-M)", () => {
  test("produces an identical tuple string for two candidates differing only in thresholdRuleSetVersion", () => {
    // `thresholdRuleSetVersion` is NOT declared on `SignatureTupleInput` at
    // all (D-6) — the allowlist type is what makes this structural. Handing
    // it in anyway (via the widened test-local type) and varying ONLY that
    // field must produce the exact same tuple string.
    const sharedEvidenceShape = fixtureEvidenceShape();
    const withLowThresholdVersion: InputWithIgnoredField = {
      projectId: PROJECT_ID,
      surfaceId: SURFACE,
      symptomClass: "broken",
      evidenceShape: sharedEvidenceShape,
      thresholdRuleSetVersion: 3,
    };
    const withHighThresholdVersion: InputWithIgnoredField = {
      projectId: PROJECT_ID,
      surfaceId: SURFACE,
      symptomClass: "broken",
      evidenceShape: sharedEvidenceShape,
      thresholdRuleSetVersion: 42,
    };

    expect(signatureTuple(withLowThresholdVersion, 1)).toBe(
      signatureTuple(withHighThresholdVersion, 1),
    );
  });

  test("produces a different tuple string for two candidates differing only in finalClass", () => {
    // The should-fork SIBLING of the test above — without this, a
    // constant-returning serialiser would pass the thresholdRuleSetVersion
    // test for free. `evidenceShape` is held IDENTICAL across both inputs so
    // only `SignatureTupleInput.symptomClass` itself varies, isolating the
    // field this test is actually about.
    const sharedEvidenceShape = fixtureEvidenceShape({ symptomClass: "broken" });
    const brokenInput = baseInput({ symptomClass: "broken", evidenceShape: sharedEvidenceShape });
    const confusingInput = baseInput({
      symptomClass: "confusing",
      evidenceShape: sharedEvidenceShape,
    });

    expect(signatureTuple(brokenInput, 1)).not.toBe(signatureTuple(confusingInput, 1));
  });
});
