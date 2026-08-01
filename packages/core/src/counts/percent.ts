// The percent scale, the unit of the rule set's `*Percent` members, and the only
// numeric literal any comparison against one is allowed to need.
//
// House rule: no unnamed numeric literals in a detector or predicate body. A named
// constant is not merely tolerated there, it is what that rule is asking for. The
// opposite of the magic number. And this magnitude cannot come from the rule set: every
// `ThresholdRuleSet` member is an under-detect assertion gate, whereas this is
// arithmetic.
// A rule set that could set the scale to `1000` would silently move every threshold it
// also carries.
//
// It lives here, under `counts/`, rather than in `rules/`, precisely so it does not
// read as rule-set provenance: it is the unit `MeasuredCount` numerators are compared
// in, imported by both `detect/` and `evidence/` so the two can never drift to
// different scales.

/**
 * Rates are integer percentages (`40`, not `0.4`), compared with exact integer
 * arithmetic, `numerator * PERCENT_SCALE >= percent * denominator`.
 *
 * Float division would put the inclusive "fires at exactly the threshold" one ulp away
 * from "fires just above it", which no test written in floats can see. It is also what
 * lets `canonicalJson`, the function the rule set is hashed through, stay integer-only.
 */
export const PERCENT_SCALE = 100;
