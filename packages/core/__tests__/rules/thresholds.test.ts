// Unit tests for threshold rule sets: all four named tests.
//
// Why `node:crypto` appears here and nowhere else. needs a hash; the product does not.
// Keeping `createHash` inside this test file is what keeps `packages/core` free of
// every node builtin, which in turn is what makes the "no clock, no randomness"
// auditable by construction. A Wave 6 ast test asserts the package imports no node
// builtin at all, and that test is only meaningful while this import stays on the test
// side of the line. Do not move this import, or the hashing it enables, into `src/`.
//
// What closes. shipped `EXCLUSION_RULE_SET_VERSION` with nothing tying it to its token
// lists' contents: a contributor could edit a shipped rule without bumping the version
// and no gate caught it. Every stamp on record silently reinterpreted. This file is
// that missing gate for the threshold rule set. Retrofitting it to the exclusion rule
// set is, and is now a copy of the test below.
import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { canonicalJson } from "../../src/serialise/canonical-json";
import {
  CURRENT_THRESHOLD_RULE_SET,
  THRESHOLD_RULE_SETS,
  THRESHOLD_RULE_SET_VERSION,
} from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

/**
 * The v1 rule set fetched by version, never by "whatever is current". The whole
 * property asserts is that this lookup keeps working, unchanged, after v2 lands. Copied
 * from `packages/shared/__tests__/exclusions/ classify.test.ts`'s `ruleSetV1`,
 * deliberately: the spec says these rule sets mirror `EXCLUSION_RULE_SETS`
 * exactly, and so do their tests.
 */
function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

/**
 * The words the spec requires, verbatim. A hash mismatch is not a puzzle to be
 * solved by re-pinning the golden. It is a reviewer telling you that you edited a
 * decision that has already shipped.
 */
const IMMUTABILITY_MESSAGE =
  "v1 is a shipped decision and is immutable. Add version 2 — do not edit version 1.";

/**
 * The golden. `sha256(canonicalJson(THRESHOLD_RULE_SETS.get))`, over a 563-character
 * canonical serialisation that begins `{"brokenProofSignals":["failure_correlated"],…`
 * and ends `,"version":1}`.
 *
 * Pinned in Wave 3, the day `canonicalJson` landed. **A paste here is only ever
 * legitimate when v1 is still unshipped and its content genuinely changed in the same
 * commit**, which is what happened the one time it moved: `passiveEventNames` was added
 * to close a confirmed over-detect in `error_event` (a `$pageview` was being named as
 * the action an exception broke, which walked a fabricated `broken` claim straight
 * through the gate). The rule set really did change, so the hash really did change, and
 * the assertion below was not relaxed to accommodate it.
 *
 * It moved a second time, under the same rule, when `struggleMinStrugglingSessions` was
 * added. The cohort floor that pairs with the `strugglingSessions` MeasuredCount on the
 * struggle signal. Legitimacy checked before re-pinning, not assumed: `packages/core`
 * does not exist on `origin/main`, so v1 has never shipped and NO judgement is on
 * record under the previous value. The guard's premise ("every judgement on record was
 * made under the old value") is simply not true yet. It becomes true the moment this
 * branch merges, and from then on the only legitimate change is a version 2.
 *
 * Third move, same still-unshipped v1: `vendorEventPrefix` and
 * `userInitiatedVendorEvents` were added to close a confirmed false-claim path the
 * audits both found. An unlisted vendor event (`$feature_flag_called` and friends)
 * could be named as "the thing the user was trying to do", and the gate would then tell
 * a founder we proved their user's action failed when nobody was acting. The denylist
 * could not enumerate a vendor namespace that grows with every PostHog release; the
 * prefix rule does not have to.
 *
 * Once v1 ships, a change here is only legitimate as a deliberate version 2. A new
 * entry in `THRESHOLD_RULE_SETS` with its own golden beside this one, never a re-pin of
 * this line. Re-pinning it to silence a red test you did not intend is precisely the
 * failure `IMMUTABILITY_MESSAGE` describes, and it silently reinterprets every
 * judgement already stamped with version 1.
 */
const V1_CONTENT_HASH: string = "de73a91a398a32b3c5ff0696bd86b9d8fbb12df3a5ca51c94dc7d201414e92ab";

/** Fail direction is a property of a magnitude. Names and the version have none. */
type FailDirection = "under_detect" | "not_a_magnitude";

type FailDirectionNote = {
  readonly direction: FailDirection;
  /** What this magnitude is conservative about, in the customer's terms. */
  readonly because: string;
};

/**
 * the documentation, as data rather than prose.
 *
 * Typed `Record<keyof ThresholdRuleSet, …>` so adding a member to `ThresholdRuleSet`
 * without declaring its fail direction is a compile error, and enumerated at runtime
 * below so it is also a test failure. Both, because they catch different mistakes: the
 * type catches a new threshold, the enumeration catches this table drifting away from
 * the value it claims to describe.
 *
 * Every magnitude here fails toward under-detect. These are assertion gates. They
 * decide which claims are made to a founder, not which sessions are skimmed, so a
 * missed finding is recoverable and a false `broken` claim burns the credibility the
 * MVP exists to test. Architecture the "T1 fails toward including" governs the cost
 * funnel, and this sprint contains no cost gate at all.
 */
const DECLARED_FAIL_DIRECTIONS: Record<keyof ThresholdRuleSet, FailDirectionNote> = {
  vendorEventPrefix: {
    direction: "not_a_magnitude",
    because:
      "a namespace marker, not a threshold — it decides WHOSE event this is, and the judgement direction it enables is declared on userInitiatedVendorEvents",
  },
  userInitiatedVendorEvents: {
    direction: "under_detect",
    because:
      "a vendor event missing from this list is treated as passive; adding one can only ever create correlations, so growing the list cannot manufacture a claim retroactively",
  },
  version: {
    direction: "not_a_magnitude",
    because: "the rule set's own identity, not a judgement it makes",
  },
  exceptionEventName: {
    direction: "not_a_magnitude",
    because: "a name pinned by Addendum A ROW A-1, so there is nothing to be conservative about",
  },
  passiveEventNames: {
    direction: "under_detect",
    because:
      "a page load, an unload, an identity stamp and a web-vitals report are things that happened TO the user, so none of them may be named as the action an exception broke — adding a name here only ever removes correlations",
  },
  errorCorrelationWindowMs: {
    direction: "under_detect",
    because: "narrow enough that an exception 45 seconds after the click is not attributed to it",
  },
  errorMinAffectedSessions: {
    direction: "under_detect",
    because: "one session with an exception is an anecdote, not a finding",
  },
  funnelMinSessionsAtOrigin: {
    direction: "under_detect",
    because: "a denominator below 20 cannot support a rate claim to a founder",
  },
  funnelMinDropoffSessions: {
    direction: "under_detect",
    because: "an absolute floor beneath the rate, so a 100% drop of 2 sessions never fires",
  },
  funnelDropoffRateThresholdPercent: {
    direction: "under_detect",
    because: "40% is well above ordinary funnel attrition",
  },
  struggleRepeatedAttemptMin: {
    direction: "under_detect",
    because: "two visits to a path is navigation; three is a pattern — for ONE session",
  },
  struggleMinStrugglingSessions: {
    direction: "under_detect",
    because:
      'the per-session maximum is a maximum over the whole cohort, so it only rises as the corpus grows — three separate sessions must have come back before the sentence a founder reads on a satisfied confusing rung ("People hesitated, went back, or tried the same thing more than once here") is true of the surface rather than of one outlier',
  },
  instrumentationDropRatioPercent: {
    direction: "under_detect",
    because: "observed must fall below 20% of expected before the class fires",
  },
  instrumentationMinExpected: {
    direction: "under_detect",
    because: "no rate claim on a tiny expected baseline",
  },
  brokenProofSignals: {
    direction: "under_detect",
    because:
      "excludes failure_uncorrelated (ES-13), so an exception unrelated to the user's action is never laundered into a broken claim",
  },
  confusingProofSignals: {
    direction: "under_detect",
    because: "a positive struggle signal is required; an ordinary exit is not confusion",
  },
  changedMindProofSignals: {
    direction: "under_detect",
    because:
      "a clean exit is required as a positive signal, and the predicate adds an absence requirement on top of it",
  },
  instrumentationProofSignals: {
    direction: "under_detect",
    because: "a measured rate drop is required; a missing event alone is not a break",
  },
};

/**
 * The floor the funnel detector's rate gate imposes on `dropped`, evaluated at the
 * smallest denominator its origin gate will admit.
 *
 * `Math.ceil` because sessions are whole: at `atOrigin = funnelMinSessionsAtOrigin`,
 * this is the least integer `dropped` satisfying `dropped * 100 >=
 * funnelDropoffRateThresholdPercent * atOrigin`.
 *
 * Module scope rather than inside the test that uses it: it captures nothing from the
 * enclosing scope, taking the rule set as its only input.
 */
const rateImpliedFloor = (rules: ThresholdRuleSet): number =>
  Math.ceil((rules.funnelDropoffRateThresholdPercent * rules.funnelMinSessionsAtOrigin) / 100);

describe("THRESHOLD_RULE_SETS", () => {
  // item 1. The literal below is the pin: fetching v1 by version must keep reproducing
  // this decision byte for byte after v2 lands. It is written out verbatim rather than
  // compared against the `*_PROOF_SIGNALS_V1` constants. Importing those would make the
  // assertion agree with whatever they happen to say, which is not a pin at all.
  //
  // The two rates are integer percentages, not 0.4 / 0.2: hashes this rule set
  // through `canonicalJson`, which refuses a floating-point value, and integer
  // percentages also make the inclusive boundary exact rather than ulp-fragile.
  test("should expose THRESHOLD_RULE_SETS.get(1) reproducing a v1 decision exactly", () => {
    expect(ruleSetV1()).toEqual({
      version: 1,
      exceptionEventName: "$exception",
      passiveEventNames: ["$pageview", "$pageleave", "$identify", "$web_vitals"],
      vendorEventPrefix: "$",
      userInitiatedVendorEvents: ["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"],
      errorCorrelationWindowMs: 30_000,
      errorMinAffectedSessions: 3,
      funnelMinSessionsAtOrigin: 20,
      funnelMinDropoffSessions: 5,
      funnelDropoffRateThresholdPercent: 40,
      struggleRepeatedAttemptMin: 3,
      struggleMinStrugglingSessions: 3,
      instrumentationDropRatioPercent: 20,
      instrumentationMinExpected: 50,
      brokenProofSignals: ["failure_correlated"],
      confusingProofSignals: ["struggle"],
      changedMindProofSignals: ["clean_exit"],
      instrumentationProofSignals: ["instrumentation_rate_drop"],
    });
  });

  // item 2, the one that closes the gap.
  //
  // Item 1 above pins the fields it names. This pins the whole value, through one
  // deterministic serialisation, so a field nobody thought to list. A token added to a
  // proof-signal list, a magnitude nudged "harmlessly". Is caught too. That is the
  // difference between a test that documents v1 and a test that makes v1 immutable.
  test('should fail with an "add v2, do not edit v1" message when a v1 value changes (content hash)', () => {
    const serialised = canonicalJson(ruleSetV1());
    const actual = createHash("sha256").update(serialised, "utf8").digest("hex");

    // Thrown rather than asserted so the words the spec requires are literally in
    // the failure output, not buried under a hex diff.
    if (actual !== V1_CONTENT_HASH) {
      throw new Error(
        `${IMMUTABILITY_MESSAGE}\n` +
          `  expected sha256: ${V1_CONTENT_HASH}\n` +
          `  actual sha256:   ${actual}\n` +
          `  serialised v1:   ${serialised}\n` +
          `A threshold change is a migratable event (every judgement on record was made under the old value), never an in-place edit.`,
      );
    }

    expect(actual).toBe(V1_CONTENT_HASH);
  });

  // item 3. The version travels inside the value, exactly as `ExclusionRuleSet` does,
  // so a rule set handed to a detector as a parameter carries its own provenance, and a
  // judgement can say which rules produced it without the caller having to remember.
  //
  // Enumerated over the map rather than asserted on v1 alone: the invariant is "every
  // entry agrees with its key", which must still hold the day v2 lands.
  test("should carry its own version inside the rule set value", () => {
    expect(THRESHOLD_RULE_SETS.size).toBeGreaterThan(0);

    for (const [key, ruleSet] of THRESHOLD_RULE_SETS) {
      expect(ruleSet.version).toBe(key);
    }

    expect(CURRENT_THRESHOLD_RULE_SET.version).toBe(THRESHOLD_RULE_SET_VERSION);
    expect(THRESHOLD_RULE_SETS.get(THRESHOLD_RULE_SET_VERSION)).toBe(CURRENT_THRESHOLD_RULE_SET);
  });

  // item 4. Enumerates the rule set's own keys. A hand-listed set of keys would
  // silently stop covering a threshold added later, which is exactly the miss this test
  // exists to prevent.
  test("should declare an under-detect fail direction for every threshold", () => {
    const documented = new Map<string, FailDirectionNote>(Object.entries(DECLARED_FAIL_DIRECTIONS));
    const v1 = ruleSetV1();
    const keys = Object.keys(v1);

    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const note = documented.get(key);
      if (!note) {
        throw new Error(
          `\`${key}\` is a member of the threshold rule set with no declared fail direction. ` +
            `FR-9 requires every threshold to state which way it fails and what it is conservative about.`,
        );
      }
      expect(note.because.length).toBeGreaterThan(0);

      // A magnitude is anything the rule set judges with: every number except the
      // version, and every proof-signal list. Only a name (a string) or the version
      // itself may claim to have no fail direction, so a new threshold cannot be waved
      // through by declaring it "not a magnitude".
      const value = v1[key as keyof ThresholdRuleSet];
      const isMagnitude = key !== "version" && typeof value !== "string";
      if (isMagnitude && note.direction !== "under_detect") {
        throw new Error(
          `\`${key}\` is a magnitude and must fail toward UNDER-DETECT (FR-9), not "${note.direction}". ` +
            `These are assertion gates: a missed finding is recoverable, a false claim burns the credibility the MVP exists to test.`,
        );
      }
      if (!isMagnitude) {
        expect(note.direction).toBe("not_a_magnitude");
      }
    }

    // The table must not drift the other way either. A direction declared for a key the
    // rule set no longer has is stale documentation reading as coverage.
    for (const documentedKey of documented.keys()) {
      expect(keys).toContain(documentedKey);
    }
  });

  // The bump and its proof, together: `THRESHOLD_RULE_SET_VERSION` is now 2, and rule
  // set 1 stays resolvable by key and byte-identical to the same literal item 1 above
  // pins, not merely "still equal to some v1 object", so this test cannot pass by
  // drifting alongside an accidental edit to that literal. It also re-checks the
  // content hash independently of item 2 above, because "the fields look right" and
  // "the golden still matches" are different failure modes and this is the one test
  // that must catch both after a version bump.
  test("THRESHOLD_RULE_SET_VERSION is 2 and rule set 1 remains registered and byte-identical", () => {
    expect(THRESHOLD_RULE_SET_VERSION).toBe(2);

    const v1 = ruleSetV1();
    expect(v1).toEqual({
      version: 1,
      exceptionEventName: "$exception",
      passiveEventNames: ["$pageview", "$pageleave", "$identify", "$web_vitals"],
      vendorEventPrefix: "$",
      userInitiatedVendorEvents: ["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"],
      errorCorrelationWindowMs: 30_000,
      errorMinAffectedSessions: 3,
      funnelMinSessionsAtOrigin: 20,
      funnelMinDropoffSessions: 5,
      funnelDropoffRateThresholdPercent: 40,
      struggleRepeatedAttemptMin: 3,
      struggleMinStrugglingSessions: 3,
      instrumentationDropRatioPercent: 20,
      instrumentationMinExpected: 50,
      brokenProofSignals: ["failure_correlated"],
      confusingProofSignals: ["struggle"],
      changedMindProofSignals: ["clean_exit"],
      instrumentationProofSignals: ["instrumentation_rate_drop"],
    });

    const serialisedV1 = canonicalJson(v1);
    const actualV1Hash = createHash("sha256").update(serialisedV1, "utf8").digest("hex");
    expect(actualV1Hash).toBe(V1_CONTENT_HASH);

    // Rule set 2 is registered, is current, and its numeric values are unchanged from
    // v1. Only `version` may differ (the semantics of three of these numbers changed,
    // the printed values did not). Asserted structurally, v1's fields minus `version`,
    // compared against v2's fields minus `version`, rather than by re-listing every
    // field a second time, so this assertion cannot silently drift out of sync with the
    // v1 pin above.
    const v2 = THRESHOLD_RULE_SETS.get(2);
    if (!v2) throw new Error("threshold rule set version 2 must be registered");
    expect(v2.version).toBe(2);
    const { version: _v1Version, ...v1Values } = v1;
    const { version: _v2Version, ...v2Values } = v2;
    expect(v2Values).toEqual(v1Values);

    expect(THRESHOLD_RULE_SETS.size).toBe(2);
    expect(CURRENT_THRESHOLD_RULE_SET).toBe(v2);
  });

  // The property a FALSE comment once claimed had changed.
  //
  // An earlier `RULE_SET_V2` comment argued that the per-origin aggregation made
  // `funnelMinDropoffSessions` newly reachable, and offered that as a second,
  // independent justification for the version bump. It is false, and this test is the
  // reason nobody has to take that on trust again.
  //
  // The funnel detector applies three gates in order
  // (`../../src/detect/funnel-dropoff.ts`):
  // 1. `atOrigin >= funnelMinSessionsAtOrigin`
  // 2. `dropped >= funnelMinDropoffSessions`
  // 3. `dropped * 100 >= funnelDropoffRateThresholdPercent * atOrigin` Gate 1 pins the
  //  smallest legal denominator, and at that denominator gate 3 implies its own floor
  //  on `dropped`. Whenever that rate-implied floor is at least
  //  `funnelMinDropoffSessions`, gate 2 can never be the binding constraint (gate 3
  //  subsumes it) so deleting gate 2 would change no outcome. Aggregation moves the
  //  numerator and the denominator together and cannot disturb that.
  //
  // Derived from the rule set's own values, never from hardcoded numbers: the point of
  // the test is that a future threshold edit which makes the floor genuinely reachable
  // fails here and forces the comment on `RULE_SET_V2` to be rewritten honestly, rather
  // than the comment quietly going stale again. Asserted for v1 as well as v2, because
  // "unreachable under v1 too" is the whole finding.
  test("funnelMinDropoffSessions remains structurally unreachable under v2 aggregation", () => {
    for (const [version, rules] of THRESHOLD_RULE_SETS) {
      const floor = rateImpliedFloor(rules);

      if (floor < rules.funnelMinDropoffSessions) {
        throw new Error(
          `Rule set v${version}: funnelMinDropoffSessions (${rules.funnelMinDropoffSessions}) is now REACHABLE — ` +
            `the rate gate only implies dropped >= ${floor} at the smallest legal denominator ` +
            `(funnelDropoffRateThresholdPercent ${rules.funnelDropoffRateThresholdPercent} x funnelMinSessionsAtOrigin ${rules.funnelMinSessionsAtOrigin} / 100). ` +
            `That is a real behaviour change, and the comment on RULE_SET_V2 currently states the opposite. ` +
            `Rewrite that comment to match this arithmetic — do not delete this test.`,
        );
      }

      expect(floor).toBeGreaterThanOrEqual(rules.funnelMinDropoffSessions);
    }

    // Both shipped rule sets are covered, so neither version can be quietly dropped
    // from the map to make this pass.
    expect([...THRESHOLD_RULE_SETS.keys()]).toEqual([1, 2]);
  });
});
