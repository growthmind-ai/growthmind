// The percent scale — the UNIT of the rule set's `*Percent` members, and the
// only numeric literal any comparison against one is allowed to need.
//
// PL ruling 26: FR-8 forbids UNNAMED numeric literals in a detector or
// predicate body. A named constant is not merely tolerated there, it is what
// FR-8 is asking for — the opposite of the magic number. And this magnitude
// cannot come from the rule set: PL ruling 4 makes every `ThresholdRuleSet`
// member an under-detect assertion gate, whereas this is arithmetic. A rule
// set that could set the scale to `1000` would silently move every threshold
// it also carries.
//
// It lives HERE, under `counts/`, rather than in `rules/`, precisely so it does
// not read as rule-set provenance: it is the unit `MeasuredCount` numerators
// are compared in, imported by both `detect/` and `evidence/` so the two can
// never drift to different scales.

/**
 * PL ruling 1: rates are INTEGER percentages (`40`, not `0.4`), compared with
 * exact integer arithmetic — `numerator * PERCENT_SCALE >= percent * denominator`.
 *
 * Float division would put D-6's inclusive "fires at exactly the threshold"
 * one ulp away from "fires just above it", which no test written in floats can
 * see. It is also what lets `canonicalJson` stay integer-only (D-13), which
 * FR-11 hashes the rule set through.
 */
export const PERCENT_SCALE = 100;
