// "Unit tests (`packages/core`") the named tests for `signatureTuple`.
//
// This is a Wave 0 tdd contract task: `signatureTuple` and `serialiseV1` still throw
// `not implemented`. Every assertion below is written against the final exported
// contract in `signature-tuple.ts`, so this suite must typecheck cleanly today and fail
// red until a later wave fills the bodies in.
//
// What this file pins:
// 1. v1 is frozen, it must emit the literal `1`, never read
//  `SIGNATURE_TUPLE_VERSION` (a later bump must not reach back and
//  rewrite every v1 identity on record).
// 2. Dispatch is by version, through the map. An unregistered version
//  Throws rather than silently falling back to "current" (fail
//  direction: refuse).
// 3. The tuple string is produced through `canonicalJson` and only
//  `canonicalJson` — no second definition of "canonical" anywhere in
//  this module (precedent).
// 4. Fr-m / the load-bearing pair: `thresholdRuleSetVersion` is not
//  an identity input at all (two inputs differing only in it collapse to
//  one tuple string), and its anti-vacuity sibling — `symptomClass` IS
//  an identity input (two inputs differing only in it fork).
// 5. A `null` `surfaceNormalisationVersion`, arriving through the real
//  `evidenceShape` input path, serialises deterministically and does
//  not throw.
//
// No clock and no randomness anywhere in this file. Every fixture is a literal.
import { describe, expect, test } from "bun:test";

import { evidenceShape } from "../../src/findings/evidence-shape";
import type { EvidenceShapeInput } from "../../src/findings/evidence-shape";
import { SIGNATURE_TUPLE_SERIALISERS, signatureTuple } from "../../src/findings/signature-tuple";
import type { SignatureTupleInput } from "../../src/findings/signature-tuple";
import { canonicalJson } from "../../src/serialise/canonical-json";

// source-text scanner (non-vacuity, `purity.test.ts` precedent)
//
// Fr-a's frozen-literal claim used to be proven by re-importing this module with
// `SIGNATURE_TUPLE_VERSION` stubbed via `mock.module`. That is a Bun-process-global:
// registering it here corrupted an unrelated file
// (`packages/db/__tests__/services/signature-ledger.service.test.ts`) the moment both
// suites ran in one process, because `mock.module` patches the module registry for the
// whole test run, not just this file (cross-file test-pollution bug). Replaced with the
// same technique `packages/core/__tests__/detect/purity.test.ts` uses to prove "no node
// builtin": read the shipped source text off disk and assert a property of it, never
// execute a mutated copy of the module.

const SIGNATURE_TUPLE_SRC_PATH = `${import.meta.dir}/../../src/findings/signature-tuple.ts`;

/**
 * The balanced-brace body of one named function declaration. From the `function
 * <name>(` keyword through its own closing brace, found at column zero after the
 * parameter list the same way `purity.test.ts`'s `collectFunctionRegions` finds a
 * top-level declaration's own terminator: a nested block (the `if` inside
 * `signatureTuple`, the object literal inside `serialiseV1`) is always indented, so it
 * can never be mistaken for the function's own end.
 */
function functionBody(source: string, functionName: string): string {
  const head = new RegExp(`function\\s+${functionName}\\s*\\(`).exec(source);
  if (head === null) return "";

  let depth = 0;
  let paramEnd = -1;
  for (let index = head.index + head[0].length - 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        paramEnd = index;
        break;
      }
    }
  }
  if (paramEnd === -1) return "";

  const terminator = source.indexOf("\n}", paramEnd);
  const stop = terminator === -1 ? source.length : terminator + 2;
  return source.slice(head.index, stop);
}

// fixtures

/** A `randomUUID`-shaped literal, `SignatureTupleInput.projectId` is never re-derived,
 * so any fixed string stands in fine. */
const PROJECT_ID = "b3d43e3f-8f2a-4b8b-9a4b-1d9d9a8f5b21";
/** Already a `normaliseUrlPath` fixed point. This module does not re-normalise, so a
 * fixture that were not normalised would prove nothing about `signatureTuple` itself. */
const SURFACE = "/checkout";

/**
 * A real `evidence_shape` string, produced through the actual (already implemented,
 * non-scaffold) `evidenceShape` serialiser, never a hand-written JSON literal
 * masquerading as one. `signatureTuple` treats this as an opaque string; building it
 * through the real function is what proves the two modules actually compose.
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

/** An input plus arbitrary extra keys. The vehicle for fr-m's "differing only in
 * `thresholdRuleSetVersion`" fixture. `SignatureTupleInput` has no such field: the
 * intersection is what lets a test hand one in anyway without weakening the allowlist
 * type itself. */
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

describe("signatureTuple — the v1 serialiser is frozen (FR-A b, )", () => {
  test("should emit a literal v1 and never the current version constant", async () => {
    // Behavioural half: the real, unmocked module.
    const v1 = SIGNATURE_TUPLE_SERIALISERS.get(1);
    expect(v1).toBeDefined();
    expect(v1!(baseInput())).toContain('"v":1');

    // Source-text half, the actual fr-a/ proof. Read `serialiseV1`'s own declared
    // body off disk and assert it hardcodes the literal `1` rather than reading
    // `SIGNATURE_TUPLE_VERSION`. Had it read the mutable constant instead, a later
    // version bump would silently rewrite every v1 identity already on record. Every
    // dismissal and never-twice guarantee hanging off those digests would detach.
    const source = await Bun.file(SIGNATURE_TUPLE_SRC_PATH).text();
    expect(source.length).toBeGreaterThan(0);

    const serialiseV1Body = functionBody(source, "serialiseV1");
    const signatureTupleBody = functionBody(source, "signatureTuple");

    // Anti-vacuity: the extractor actually located both declarations, and each is a
    // whole body ending at its own closing brace, not an empty string from a regex that
    // silently failed to match.
    expect(serialiseV1Body.length).toBeGreaterThan(0);
    expect(serialiseV1Body).toContain("canonicalJson(tuple)");
    expect(serialiseV1Body.trimEnd().endsWith("}")).toBe(true);
    expect(signatureTupleBody.length).toBeGreaterThan(0);
    expect(signatureTupleBody).toContain("SIGNATURE_TUPLE_SERIALISERS.get(version)");
    expect(signatureTupleBody.trimEnd().endsWith("}")).toBe(true);

    // Anti-vacuity: the same extractor and the same identifier check DO find
    // `SIGNATURE_TUPLE_VERSION` when it is genuinely present in a function body. The
    // dispatcher's own refuse-and-throw message names it. This proves the "must not
    // contain" assertion below means something, rather than the check being blind to
    // the identifier everywhere.
    expect(signatureTupleBody).toContain("SIGNATURE_TUPLE_VERSION");

    // The frozen-literal claim itself.
    expect(serialiseV1Body).toMatch(/\bv\s*:\s*1\b/);
    expect(serialiseV1Body).not.toContain("SIGNATURE_TUPLE_VERSION");
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

describe("signatureTuple — no second definition of canonical", () => {
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

    // Key order is lexicographic by code unit, `canonicalJson`'s guarantee, not
    // something `signatureTuple` orders itself. Extracted keys must already be in
    // sorted order in the output.
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
    // The null case travels through the real evidence-shape input path (a row written
    // before versions were recorded) rather than a hand-rolled string standing in for
    // it.
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

describe("signatureTuple — closed NO, both halves of the pair (, FR-M)", () => {
  test("produces an identical tuple string for two candidates differing only in thresholdRuleSetVersion", () => {
    // `thresholdRuleSetVersion` is not declared on `SignatureTupleInput` at all. The
    // allowlist type is what makes this structural. Handing it in anyway (via the
    // widened test-local type) and varying only that field must produce the exact same
    // tuple string.
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
    // The should-fork sibling of the test above, without this, a constant-returning
    // serialiser would pass the thresholdRuleSetVersion test for free. `evidenceShape`
    // is held identical across both inputs so only `SignatureTupleInput.symptomClass`
    // itself varies, isolating the field this test is actually about.
    const sharedEvidenceShape = fixtureEvidenceShape({ symptomClass: "broken" });
    const brokenInput = baseInput({ symptomClass: "broken", evidenceShape: sharedEvidenceShape });
    const confusingInput = baseInput({
      symptomClass: "confusing",
      evidenceShape: sharedEvidenceShape,
    });

    expect(signatureTuple(brokenInput, 1)).not.toBe(signatureTuple(confusingInput, 1));
  });
});
