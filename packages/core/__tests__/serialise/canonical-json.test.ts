// Unit tests for canonical serialisation: the four named tests for `canonicalJson`, plus the
// rule-set serialisability property exists to preserve.
//
// The contract these tests pin (binding):
// 1. object keys are emitted lexicographically by code unit, never in
//  insertion order — so two structurally equal inputs built in different
//  orders serialise byte-identically;
// 2. All primitive arrays are treated as sets. Sorted and de-duplicated;
// 3. a non-integer number throws. The fail direction is refuse rather than
//  Format: a serialiser that guesses at float formatting produces an
//  identity that forks on the guess, and every guarantee hanging off that
//  identity (never deliver twice, dismissed forever, never re-propose)
//  then fails open silently.
//
// No clock, no randomness, no node builtin in this file, the same discipline the
// package itself is held to.
import { describe, expect, test } from "bun:test";

import { THRESHOLD_RULE_SETS } from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";
import { canonicalJson } from "../../src/serialise/canonical-json";
import type { CanonicalObject, CanonicalValue } from "../../src/serialise/canonical-json";

/** The v1 rule set fetched by version, never "whatever is current". */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

describe("canonicalJson — key ordering", () => {
  test("should emit keys in declared order regardless of input insertion order", () => {
    // The same logical evidence shape, built in two different insertion orders.
    // `JSON.stringify` would emit these differently; `canonicalJson` must not.
    const built: CanonicalObject = {
      surface: "/checkout",
      detector: "funnel_dropoff",
      v: 1,
      // Nested objects are ordered by the same rule, recursively. `B` before `a` is the
      // discriminator between ordering by code unit (which puts every uppercase letter
      // first) and ordering by locale collation (which would emit `a` first). Ruling 5
      // says code unit.
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
    // `signalKinds` is the real case: v1 serialises the sorted, de-duplicated `kind`
    // values present on a candidate. Two sessions contributing the same kind must not
    // change the identity, and neither must the order the detector happened to append
    // them in.
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
    // Fail direction: refuse, never format. The message must name the reason (an
    // integer/float complaint) so the refusal is debuggable and is distinguishable from
    // any other throw on this path.
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
    // The churn event, not "the same input twice": re-ordered keys, a re-ordered signal
    // list, and a duplicate signal. The three ways the same logical evidence
    // legitimately arrives in a different literal shape. All three must collapse to one
    // string.
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
    // This is the property ruling 1 exists to preserve. hashes the rule set through
    // `canonicalJson`, and `canonicalJson` refuses floats, so every rate in the rule
    // set is an integer percentage (`funnelDropoffRateThresholdPercent: 40`, not
    // `0.4`). If a later version reintroduces a float rate, this test is what fails.
    const ruleSet = ruleSetV1() satisfies CanonicalValue;

    expect(() => canonicalJson(ruleSet)).not.toThrow();
    expect(canonicalJson(ruleSet)).toContain('"funnelDropoffRateThresholdPercent":40');
    expect(canonicalJson(ruleSet)).toContain('"instrumentationDropRatioPercent":20');
  });
});
