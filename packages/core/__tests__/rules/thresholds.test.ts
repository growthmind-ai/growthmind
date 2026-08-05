import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { canonicalJson } from "../../src/serialise/canonical-json";
import {
  CURRENT_THRESHOLD_RULE_SET,
  THRESHOLD_RULE_SETS,
  THRESHOLD_RULE_SET_VERSION,
} from "../../src/rules/thresholds";
import type { ThresholdRuleSet } from "../../src/rules/types";

function ruleSetV1(): ThresholdRuleSet {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable forever");
  return rules;
}

const IMMUTABILITY_MESSAGE =
  "v1 is a shipped decision and is immutable. Add version 2 — do not edit version 1.";

const V1_CONTENT_HASH: string = "1bc8500b799c6d292520ffb6d74849a5e534ced50c45c879d21d7b2b72f61cfc";

// Deliberately NOT typed as ThresholdRuleSet: growing that type must never force an edit here.
const V1_PRE_O041_VALUES: Readonly<Record<string, unknown>> = Object.freeze({
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

// TODO(O-041 T3.2): drop ObservedThresholdRuleSet once the six members land on ThresholdRuleSet.
// See .ai/adds/o-041-observed-struggle.md D-9.
type ObservedThresholdRuleSet = ThresholdRuleSet & {
  readonly struggleRageClickMin: number;
  readonly struggleDeadClickMin: number;
  readonly struggleFieldAbandonedMin: number;
  readonly struggleFieldRefocusMin: number;
  readonly struggleScrollBackMin: number;
  readonly struggleObservedMinSessions: number;
};

const OBSERVED_THRESHOLD_KEYS = [
  "struggleRageClickMin",
  "struggleDeadClickMin",
  "struggleFieldAbandonedMin",
  "struggleFieldRefocusMin",
  "struggleScrollBackMin",
  "struggleObservedMinSessions",
] as const;

type FailDirection = "under_detect" | "not_a_magnitude";

type FailDirectionNote = {
  readonly direction: FailDirection;

  readonly because: string;
};

const DECLARED_FAIL_DIRECTIONS: Record<keyof ObservedThresholdRuleSet, FailDirectionNote> = {
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
  struggleRageClickMin: {
    direction: "under_detect",
    because:
      "the transcript builder's own rage floor is 3 clicks, so a gate equal to that floor would rubber-stamp every beat the builder emits and do no work — 4 is one clear of it",
  },
  struggleDeadClickMin: {
    direction: "under_detect",
    because:
      "one dead click is routine — a mis-click, a stray press; two on the same control is a person insisting",
  },
  struggleFieldAbandonedMin: {
    direction: "under_detect",
    because:
      "abandoning one field is ordinary; two distinct fields on one surface is a hand-signature of not being able to finish, and a threshold of 1 would grant the class for free, which the outcome forbids",
  },
  struggleFieldRefocusMin: {
    direction: "under_detect",
    because:
      "returning to a field once is normal editing; a third visit to the same field is hunting for what it wants",
  },
  struggleScrollBackMin: {
    direction: "under_detect",
    because:
      "one or two scroll-backs is reading; three is searching for something the page did not put where it was looked for",
  },
  struggleObservedMinSessions: {
    direction: "under_detect",
    because:
      "the shared cohort floor for ALL observed subkinds, deliberately above the inferred struggleMinStrugglingSessions = 3 — one recording supports description only (evidence standard §2), and this corpus is one person's, so the number is set high and re-read when strangers' sessions exist",
  },
};

const rateImpliedFloor = (rules: ThresholdRuleSet): number =>
  Math.ceil((rules.funnelDropoffRateThresholdPercent * rules.funnelMinSessionsAtOrigin) / 100);

describe("THRESHOLD_RULE_SETS", () => {
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
      struggleRageClickMin: 4,
      struggleDeadClickMin: 2,
      struggleFieldAbandonedMin: 2,
      struggleFieldRefocusMin: 3,
      struggleScrollBackMin: 3,
      struggleObservedMinSessions: 5,
      instrumentationDropRatioPercent: 20,
      instrumentationMinExpected: 50,
      brokenProofSignals: ["failure_correlated"],
      confusingProofSignals: ["struggle"],
      changedMindProofSignals: ["clean_exit"],
      instrumentationProofSignals: ["instrumentation_rate_drop"],
    });
  });

  test('should fail with an "add v2, do not edit v1" message when a v1 value changes (content hash)', () => {
    const serialised = canonicalJson(ruleSetV1());
    const actual = createHash("sha256").update(serialised, "utf8").digest("hex");

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

  test("should not change any pre-O-041 RULE_SET_V1 value when the type grows", () => {
    const live = new Map<string, unknown>(Object.entries(ruleSetV1()));
    const frozen = Object.entries(V1_PRE_O041_VALUES);

    expect(frozen.length).toBe(18);

    for (const [key, value] of frozen) {
      if (!live.has(key)) {
        throw new Error(
          `\`${key}\` was a member of RULE_SET_V1 before O-041 and has been REMOVED. ${IMMUTABILITY_MESSAGE}`,
        );
      }
      expect({ [key]: live.get(key) }).toEqual({ [key]: value });
    }
  });

  test("should carry its own version inside the rule set value", () => {
    expect(THRESHOLD_RULE_SETS.size).toBeGreaterThan(0);

    for (const [key, ruleSet] of THRESHOLD_RULE_SETS) {
      expect(ruleSet.version).toBe(key);
    }

    expect(CURRENT_THRESHOLD_RULE_SET.version).toBe(THRESHOLD_RULE_SET_VERSION);
    expect(THRESHOLD_RULE_SETS.get(THRESHOLD_RULE_SET_VERSION)).toBe(CURRENT_THRESHOLD_RULE_SET);
  });

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

    for (const documentedKey of documented.keys()) {
      expect(keys).toContain(documentedKey);
    }
  });

  test("should declare an under_detect fail direction for every new observed threshold", () => {
    const live: Partial<ObservedThresholdRuleSet> = ruleSetV1();

    expect(OBSERVED_THRESHOLD_KEYS.length).toBe(6);

    for (const key of OBSERVED_THRESHOLD_KEYS) {
      const note = DECLARED_FAIL_DIRECTIONS[key];

      expect({ [key]: note.direction }).toEqual({ [key]: "under_detect" });
      expect(note.because.length).toBeGreaterThan(0);

      const value = live[key];
      if (typeof value !== "number") {
        throw new Error(
          `\`${key}\` declares an under-detect fail direction and has no magnitude to apply it to — ` +
            `RULE_SET_V1 carries no such member (D-9). A fail direction declared against an absent ` +
            `threshold documents a gate that never runs.`,
        );
      }
      expect({ [key]: value > 0 }).toEqual({ [key]: true });
    }
  });

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
      struggleRageClickMin: 4,
      struggleDeadClickMin: 2,
      struggleFieldAbandonedMin: 2,
      struggleFieldRefocusMin: 3,
      struggleScrollBackMin: 3,
      struggleObservedMinSessions: 5,
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

    const v2 = THRESHOLD_RULE_SETS.get(2);
    if (!v2) throw new Error("threshold rule set version 2 must be registered");
    expect(v2.version).toBe(2);
    const { version: _v1Version, ...v1Values } = v1;
    const { version: _v2Version, ...v2Values } = v2;
    expect(v2Values).toEqual(v1Values);

    expect(THRESHOLD_RULE_SETS.size).toBe(2);
    expect(CURRENT_THRESHOLD_RULE_SET).toBe(v2);
  });

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

    expect([...THRESHOLD_RULE_SETS.keys()]).toEqual([1, 2]);
  });
});
