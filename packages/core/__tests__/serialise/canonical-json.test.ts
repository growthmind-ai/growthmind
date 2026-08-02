import { describe, expect, test } from "bun:test";

import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { canonicalJson } from "../../src/serialise/canonical-json";
import type { CanonicalObject, CanonicalValue } from "../../src/serialise/canonical-json";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

describe("canonicalJson — key ordering", () => {
  test("should emit keys in declared order regardless of input insertion order", () => {
    const built: CanonicalObject = {
      surface: "/checkout",
      detector: "funnel_dropoff",
      v: 1,

      nested: { a: "second", B: "first" },
    };
    const rebuilt: CanonicalObject = {
      nested: { B: "first", a: "second" },
      v: 1,
      detector: "funnel_dropoff",
      surface: "/checkout",
    };

    expect(canonicalJson(built)).toBe(
      '{"detector":"funnel_dropoff","nested":{"B":"first","a":"second"},"surface":"/checkout","v":1}',
    );
    expect(canonicalJson(rebuilt)).toBe(canonicalJson(built));
  });
});

describe("canonicalJson — set-shaped arrays", () => {
  test("should sort and de-duplicate set-shaped arrays", () => {
    const shuffled: CanonicalObject = {
      signalKinds: ["struggle", "failure_correlated", "struggle", "clean_exit"],
    };

    expect(canonicalJson(shuffled)).toBe(
      '{"signalKinds":["clean_exit","failure_correlated","struggle"]}',
    );
  });
});

describe("canonicalJson — floating-point refusal", () => {
  test("should reject a floating-point value", () => {
    const floatMessage = /(integer|float)/i;

    expect(() => canonicalJson(0.4)).toThrow(floatMessage);
    expect(() => canonicalJson({ rate: 0.4 } satisfies CanonicalObject)).toThrow(floatMessage);
    expect(() => canonicalJson({ rates: [1, 0.4] } satisfies CanonicalObject)).toThrow(
      floatMessage,
    );
  });
});

describe("canonicalJson — byte identity", () => {
  test("should produce byte-identical output for two structurally equal inputs", () => {
    const first: CanonicalObject = {
      v: 1,
      detector: "error_event",
      surface: "/checkout",
      surfaceNormalisationVersion: 1,
      signalKinds: ["failure_correlated", "struggle"],
      symptomClass: "broken",
    };
    const second: CanonicalObject = {
      symptomClass: "broken",
      signalKinds: ["struggle", "failure_correlated", "struggle"],
      surfaceNormalisationVersion: 1,
      surface: "/checkout",
      detector: "error_event",
      v: 1,
    };

    const golden =
      '{"detector":"error_event","signalKinds":["failure_correlated","struggle"],' +
      '"surface":"/checkout","surfaceNormalisationVersion":1,"symptomClass":"broken","v":1}';

    expect(canonicalJson(first)).toBe(golden);
    expect(canonicalJson(second)).toBe(golden);
  });
});

describe("canonicalJson — the threshold rule set is serialisable", () => {
  test("should serialise the whole v1 threshold rule set without throwing", () => {
    const ruleSet = ruleSetV1() satisfies CanonicalValue;

    expect(() => canonicalJson(ruleSet)).not.toThrow();
    expect(canonicalJson(ruleSet)).toContain('"funnelDropoffRateThresholdPercent":40');
    expect(canonicalJson(ruleSet)).toContain('"instrumentationDropRatioPercent":20');
  });
});
