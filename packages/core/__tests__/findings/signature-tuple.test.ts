import { describe, expect, test } from "bun:test";

import { evidenceShape } from "../../src/findings/evidence-shape";
import type { EvidenceShapeInput } from "../../src/findings/evidence-shape";
import { SIGNATURE_TUPLE_SERIALISERS, signatureTuple } from "../../src/findings/signature-tuple";
import type { SignatureTupleInput } from "../../src/findings/signature-tuple";
import { canonicalJson } from "../../src/serialise/canonical-json";

const SIGNATURE_TUPLE_SRC_PATH = `${import.meta.dir}/../../src/findings/signature-tuple.ts`;

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

const PROJECT_ID = "b3d43e3f-8f2a-4b8b-9a4b-1d9d9a8f5b21";

const SURFACE = "/checkout";

function fixtureEvidenceShape(overrides: Partial<EvidenceShapeInput> = {}): string {
  return evidenceShape(
    {
      detector: "funnel_dropoff",
      surface: SURFACE,
      surfaceNormalisationVersion: 2,
      signals: [],
      proofKinds: [],
      symptomClass: "broken",
      ...overrides,
    },
    1,
  );
}

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
    const v1 = SIGNATURE_TUPLE_SERIALISERS.get(1);
    expect(v1).toBeDefined();
    expect(v1!(baseInput())).toContain('"v":1');

    const source = await Bun.file(SIGNATURE_TUPLE_SRC_PATH).text();
    expect(source.length).toBeGreaterThan(0);

    const serialiseV1Body = functionBody(source, "serialiseV1");
    const signatureTupleBody = functionBody(source, "signatureTuple");

    expect(serialiseV1Body.length).toBeGreaterThan(0);
    expect(serialiseV1Body).toContain("canonicalJson(tuple)");
    expect(serialiseV1Body.trimEnd().endsWith("}")).toBe(true);
    expect(signatureTupleBody.length).toBeGreaterThan(0);
    expect(signatureTupleBody).toContain("SIGNATURE_TUPLE_SERIALISERS.get(version)");
    expect(signatureTupleBody.trimEnd().endsWith("}")).toBe(true);

    expect(signatureTupleBody).toContain("SIGNATURE_TUPLE_VERSION");

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
    const evidenceShapeWithNullVersion = evidenceShape(
      {
        detector: "funnel_dropoff",
        surface: SURFACE,
        surfaceNormalisationVersion: null,
        signals: [],
        proofKinds: [],
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

    expect(signatureTuple(input, 1)).toBe(signatureTuple(input, 1));
  });
});

describe("signatureTuple — closed NO, both halves of the pair (, FR-M)", () => {
  test("produces an identical tuple string for two candidates differing only in thresholdRuleSetVersion", () => {
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
    const sharedEvidenceShape = fixtureEvidenceShape({ symptomClass: "broken" });
    const brokenInput = baseInput({ symptomClass: "broken", evidenceShape: sharedEvidenceShape });
    const confusingInput = baseInput({
      symptomClass: "confusing",
      evidenceShape: sharedEvidenceShape,
    });

    expect(signatureTuple(brokenInput, 1)).not.toBe(signatureTuple(confusingInput, 1));
  });
});
