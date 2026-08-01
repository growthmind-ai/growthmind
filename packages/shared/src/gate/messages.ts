// The evidence gate's plain-English reasons, one sentence per finding class per
// outcome.
//
// Why these strings live in `shared` and not beside the gate That decision requires
// every one of them to be registered in `ALL_CUSTOMER_FACING_MESSAGES`, so the
// already-hostile plain-English suite at `__tests__/session-source/messages.test.ts`
// covers them for free. The audit that decides whether a sentence is customer-readable
// is then written by someone other than the author of the sentences. That suite derives
// its scan from the exports of `session-source/messages` (its fix), so the table has to
// be reachable from there; and `packages/core` depends on `@growthmind/shared` while
// `shared` depends on nothing of ours, so a table defined in `core` could not be pulled
// back here without a package cycle.
//
// It lives here, and `packages/core/src/evidence/trace.ts` imports it back. The arrow
// stays `core -> shared`, one way.
//
// This file adds NO dependency to `shared`: it is string data and two type aliases. No
// zod, no builtin.

/**
 * The finding classes, restated here as a literal union.
 *
 * This is a second statement of `FindingClass`, whose home is
 * `packages/core/src/rules/types.ts`. Unavoidable, because `shared` may not import
 * `core`. The two cannot drift silently, in either direction:
 *
 * A class added in `core` without its two sentences here is a **compile
 *  error**, because `core`'s `trace.ts` annotates its import of this table
 *  as `GateReasonTable` — a `Record` keyed by a template literal over the
 *  real `FindingClass` — and a missing key fails that assignment;
 * A key added here without a class in `core` is a **test failure**, because
 *  `packages/core/__tests__/evidence/trace.test.ts` asserts this table has
 *  exactly eight entries and scans every key as a forbidden token.
 */
type GateReasonClass = "broken" | "confusing" | "changed_mind" | "instrumentation";

/**
 * One reason per class per outcome. Eight keys, derived from the class union rather
 * than hand-listed beside it (— the wrong string should not be expressible).
 */
export type GateReasonKey = `${GateReasonClass}_satisfied` | `${GateReasonClass}_unsatisfied`;

/**
 * What each rung of the gate's ladder says, in the customer's own terms (product
 * decisions).
 *
 * The machine-readable identifiers, `class`, `predicate`, `predicateVersion`,
 * `satisfied`, `reasonCode`. Travel on the trace entry beside this sentence,
 * separately. So the sentence itself carries no class name, no predicate identifier,
 * and no product jargon.
 *
 * The target register, from the add: "We saw people struggling here, but we could not
 * prove the save itself failed." Never: "broken -> confusing: predicate
 * failure_correlated_v1 unsatisfied."
 */
// Every `_unsatisfied` sentence is an absence statement.
//
// Read this before making one of them more vivid. A sentence here is keyed by class
// alone, so it is emitted for every reason that rung's proof failed, not just the one
// the author had in mind. An `_unsatisfied` sentence may therefore assert only that the
// proof was sought and not found. The moment it asserts a positive observation ("we saw
// people struggling"), it is claiming a fact no predicate established, and it will be
// wrong for every other path through that rung.
//
// This is not hypothetical. It shipped and was caught in review. The previous
// `broken_unsatisfied` read "We saw people struggling here, but we could not prove the
// save itself failed." Trace ruling 17's own case, an uncorrelated exception with no
// struggle signal, and the trace carried:
//
// broken_unsatisfied "We saw people struggling here,..."
// confusing_unsatisfied "We could not show that anyone struggled here,..."
//
// Two contradictory sentences in one trace, and the first one was FALSE. That is a
// wrong verdict rendered in the customer's own words. Precisely what product decisions
// ("no verdict beats a wrong verdict") and exist to prevent, and the P-2 persona reads
// this string verbatim.
//
// The target wording ("We saw people struggling here, but we could not prove the
// save itself failed") was written for the case where struggle was observed. Keyed by
// class alone, that case is not the only one. If a sentence ever needs to name what was
// seen, it needs a key carrying the reason, not a richer string on a key that cannot
// know it.
export const GATE_REASON_MESSAGES: Record<GateReasonKey, string> = {
  broken_satisfied: "We could prove the thing they were trying to do failed on them.",
  broken_unsatisfied:
    "We could not prove that anything actually failed for the people here, so we are not saying it did.",
  confusing_satisfied: "People hesitated, went back, or tried the same thing more than once here.",
  confusing_unsatisfied:
    "We could not show that anyone struggled here, so we are not making a claim about it.",
  changed_mind_satisfied:
    "People left cleanly here, with nothing going wrong and no sign of struggle.",
  changed_mind_unsatisfied:
    "We could not show that people left here with nothing going wrong, so we are not saying they simply moved on.",
  instrumentation_satisfied: "An event you rely on has almost stopped arriving.",
  instrumentation_unsatisfied:
    "We could not show that an event you rely on has stopped arriving as often as it used to.",
};
