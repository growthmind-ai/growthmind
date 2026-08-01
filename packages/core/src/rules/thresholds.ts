// The versioned threshold rule sets.
//
// Shape, comment style, and export trio are copied from
// `packages/shared/src/exclusions/classify.ts:19-40`. The closest working model in this
// repo, and the house pattern a reviewer already knows.
//
// Every detector and every gate predicate takes a rule set as a parameter. Nothing in
// this package reaches for `CURRENT_THRESHOLD_RULE_SET` internally: that is what makes
// "THRESHOLD_RULE_SETS.get reproduces a v1 decision exactly, after v2 lands" a
// property of the code rather than a hope.
//
// Fail direction, once, for the whole file: every threshold here is an assertion gate.
// It decides which claims are made to a founder, not which sessions are skimmed, so
// every one of them fails toward under-detect. A missed finding is recoverable; a false
// `broken` claim burns the credibility the MVP exists to test. Architecture the "T1
// fails toward including" governs the cost funnel (which sessions are skimmed), and
// this sprint contains no cost gate at all, so the two never meet. When adds the skim
// selector, its thresholds fail the other way and belong in their own rule set, not in
// this one.
//
// Boundaries are inclusive, everywhere, stated once here: a threshold fires at `value
// >= threshold`, a window correlates at `delta <= windowMs`. Fail direction is carried
// by the magnitude, never by boundary strictness, and each magnitude's comment says
// what it is being conservative about.
import {
  BROKEN_PROOF_SIGNALS_V1,
  CHANGED_MIND_PROOF_SIGNALS_V1,
  CONFUSING_PROOF_SIGNALS_V1,
  INSTRUMENTATION_PROOF_SIGNALS_V1,
} from "../evidence/signals";
import type { ThresholdRuleSet } from "./types";

/** The rule set new judgements are made under. */
export const THRESHOLD_RULE_SET_VERSION = 2;

const RULE_SET_V1: ThresholdRuleSet = {
  version: 1,

  /** PostHog's own reserved literal, pinned by Addendum A row A-1 (20/20 observed,
   * `$exception_list` present on every one). A name, so there is no magnitude and no
   * fail direction to declare. It lives here rather than in `error-event.ts` so no
   * detector body carries an event-name literal. */
  exceptionEventName: "$exception",

  /** Under-detect, and the strongest under-detect lever in this rule set.
   *
   * The vendor events that fire without anybody doing anything: a page load, a page
   * unload, an identity stamp, a web-vitals report. None of them is a thing a user was
   * trying to do, so none may be named as the preceding action of an exception. Without
   * this list a `$pageview` followed thirty seconds later by a third-party script error
   * produces `failure_correlated { precedingActionName: "$pageview" }` (the only signal
   * `brokenProofSignals` admits) and the gate then tells a founder "we could prove the
   * thing they were trying to do failed on them" when nobody was trying to do anything.
   * A wrong verdict in the customer's own words is the one outcome the "no verdict
   * beats a wrong verdict" principle exists to prevent.
   *
   * A denylist, not an allowlist, and that direction is the whole design. The T1
   * vocabulary probe pinned only `$exception` as present (Addendum A row A-1); every
   * interaction event name is therefore unpinned, so an allowlist would be guesswork
   * that silently drops real correlations for any name we failed to guess. A denylist
   * names only what we know to be passive and lets the unknown case fall through to the
   * action branch. Over-detect for an unknown passive vendor event, which the
   * correlation window and `errorMinAffectedSessions` still bound, rather than a
   * blanket miss.
   *
   * Adding a name to this list can only ever remove correlations, never create one:
   * that is what keeps its fail direction under-detect as it grows. */
  passiveEventNames: ["$pageview", "$pageleave", "$identify", "$web_vitals"],

  /**
   * The fail-direction fix for the denylist above (edge sweep).
   *
   * The reasoning above is right that interaction names are unpinned, but its
   * conclusion inverted this file's own priority. A denylist lets an unknown vendor
   * event fall through to the action branch, so `$feature_flag_called`, `$set`,
   * `$groupidentify` or any future PostHog release name becomes "the thing the user was
   * trying to do", and the gate then tells a founder we proved their user's action
   * failed when nobody was trying to do anything. That is the wrong-verdict outcome and
   * exist to prevent, and this file names it as the worst case four paragraphs above.
   *
   * The split below needs no guessing, because it keys on whose event it is rather than
   * on what it is called:
   *
   * No `$` prefix: the customer instrumented it themselves. `checkout_submitted` is a
   *  user action by construction. Every real correlation the denylist was protecting
   *  lives here, so nothing is dropped.
   * `$` prefix: PostHog's own. Passive unless listed as user-initiated. A set that is
   *  small, knowable, and does not grow with traffic.
   *
   * Unknown vendor names now fail toward silence instead of toward a false claim.
   * Adding a name here can only ever create correlations, so the list is the one thing
   * to review when a real interaction is being missed.
   */
  vendorEventPrefix: "$",
  userInitiatedVendorEvents: ["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"],

  /** Under-detect: narrow enough that an exception 45 seconds after the click is not
   * attributed to it. A wider window buys more correlations and every extra one is a
   * coincidence dressed as a cause. */
  errorCorrelationWindowMs: 30_000,

  /** Under-detect: one session with an exception is an anecdote, not a finding. Three
   * is the smallest number that can carry the word "people". */
  errorMinAffectedSessions: 3,

  /** Under-detect: a denominator below 20 cannot support a rate claim to a founder. "2
   * of 3 sessions dropped off" is arithmetic, not evidence. */
  funnelMinSessionsAtOrigin: 20,

  /** Under-detect: an absolute floor beneath the rate, so a 100% drop of 2 sessions
   * never fires however extreme the ratio looks. */
  funnelMinDropoffSessions: 5,

  /** Under-detect: 40% is well above ordinary funnel attrition, so the claim survives a
   * founder who already knows their own numbers.
   *
   * An integer percentage, not `0.4`: `canonicalJson` refuses floating-point values and
   * hashes this rule set through it. It also makes the inclusive boundary exact,
   * `numerator * 100 >= 40 * denominator` has no rounding, `numerator / denominator >=
   * 0.4` does. */
  funnelDropoffRateThresholdPercent: 40,

  /** Under-detect: two visits to a path is navigation; three is a pattern.
   *
   * A per-session magnitude, one person's visit depth, never a cohort total.
   * `struggleMinStrugglingSessions` below is the cohort half, and the two are separate
   * because only one of them survives a bigger corpus. */
  struggleRepeatedAttemptMin: 3,

  /** Under-detect, and the reason `struggleRepeatedAttemptMin` is safe to read as a
   * per-session maximum.
   *
   * `struggle` is the only producer of `confusing` proof this sprint, and `confusing`
   * is the only class a T1 detector can carry through the gate, so this pair is the
   * single gate between drop-off arithmetic and a delivered finding. The per-session
   * maximum alone cannot hold it: a maximum over a cohort is monotonically increasing
   * in corpus size, so at `DETECTOR_CORPUS_MAX_SESSIONS` one outlier revisiting a
   * comparison page three times would set `struggle` for the whole surface. A predicate
   * firing on a superset of its target ("at least one session came back"), which is the
   * conflation this sprint exists to prevent.
   *
   * Three, for the same reason `errorMinAffectedSessions` is three: it is the smallest
   * number that can carry the word "people", and the sentence a founder actually reads
   * on a satisfied `confusing` rung says exactly that. "People hesitated, went back, or
   * tried the same thing more than once here." One outlier session makes that sentence
   * false in the customer's own words, which the "no verdict beats a wrong verdict" principle
   * exists to prevent.
   *
   * An absolute floor rather than a share of the cohort, deliberately: the denominator
   * a signal can carry is `basis.kept` (the whole analysed corpus), not the at-origin
   * cohort, so a percentage here would be a rate over the wrong base. A subtler lie
   * than a floor. The origin cohort is separately bounded by
   * `funnelMinSessionsAtOrigin`. Tightening this to a share belongs in a v2 calibrated
   * against a real corpus, not in a guess here. */
  struggleMinStrugglingSessions: 3,

  /** Under-detect: observed must fall below 20% of expected before the class fires, so
   * ordinary week-to-week traffic variation never reads as an instrumentation break. An
   * integer percentage, for the reason above. */
  instrumentationDropRatioPercent: 20,

  /** Under-detect: no rate claim on a tiny expected baseline. Fifty is where "this
   * event stopped firing" stops being indistinguishable from "this event was always
   * rare". */
  instrumentationMinExpected: 50,

  /** The blind-spot comment lives at the constant's definition site in
   * `../evidence/signals.ts`, not here. */
  brokenProofSignals: BROKEN_PROOF_SIGNALS_V1,
  confusingProofSignals: CONFUSING_PROOF_SIGNALS_V1,
  /** Plus the absence requirement, enforced in the predicate, not the list. */
  changedMindProofSignals: CHANGED_MIND_PROOF_SIGNALS_V1,
  instrumentationProofSignals: INSTRUMENTATION_PROOF_SIGNALS_V1,
};

/**
 * Same numbers as RULE_SET_V1. Spread from it, deliberately, so "the numeric values
 * are unchanged" is a fact the compiler and the runtime both reuse rather than a claim
 * a reviewer has to eyeball across two blocks. What changed is which quantity the
 * numbers measure.
 *
 * Under v1, `funnelMinSessionsAtOrigin`, `funnelMinDropoffSessions` and
 * `funnelDropoffRateThresholdPercent` were evaluated once per (origin, destination)
 * pair. The funnel detector's emission loop ran one gate check per destination
 * reachable from an origin (`../detect/funnel-dropoff.ts`, pre-D-2 shape). the
 * aggregation rewrite collapses that emission to at most one candidate per origin:
 * `visited` and `dropped` are now counted once, across every destination `O` can reach,
 * not compared destination by destination. The same three constants below now gate a
 * per-origin quantity instead of a per-pair one.
 *
 * This is the hazard this file's own header comment warns about, made concrete. Holding
 * the version at 1 while the measured quantity changed underneath it would have
 * silently reinterpreted every threshold decision already on record. Exactly the
 * "unversioned normalisation feeding a dedup key" fork names. Bumping to v2 is what
 * keeps `THRESHOLD_RULE_SETS.get` a truthful, permanent answer to "what did v1
 * actually gate", the same discipline `exclusionRuleSetVersion` and `groupingVersion`
 * exist for at `packages/db/src/services/intake.service.ts:151-155` (verbatim: "When a
 * v2 rule set lands, `EXCLUSION_RULE_SETS.get` still reproduces this row's stamp
 * exactly, so a rule change is a migratable event rather than a silent fork").
 *
 * No second reason, and the arithmetic says so. An earlier draft of this comment argued
 * that aggregation made `funnelMinDropoffSessions: 5` newly reachable, and offered that
 * as an independent justification for the bump. It is false. The floor was structurally
 * unreachable under v1 and remains structurally unreachable under v2: a candidate must
 * clear all three gates in order (`../detect/funnel-dropoff.ts`), and gate 1 forces
 * `atOrigin >= funnelMinSessionsAtOrigin`, so gate 3 (`dropped * 100 >=
 * funnelDropoffRateThresholdPercent * atOrigin`) demands `dropped >= 40 * 20 / 100 =
 * 8`. Eight subsumes five, so deleting the `funnelMinDropoffSessions` check would
 * change no outcome. Under v2 exactly as under v1. Aggregation raises the numerator
 * (`dropped`) and the denominator (`atOrigin`) together; it cannot move a floor that
 * the rate gate already dominates at the smallest legal denominator.
 *
 * Following the precedent, that property is pinned by a named test rather than left as
 * prose a reader has to re-derive. Grep `thresholds.test.ts` for
 * `funnelMinDropoffSessions remains structurally unreachable under v2 aggregation`. It
 * derives the rate-implied floor from the rule set's own three values, so a future
 * threshold edit that makes the floor genuinely reachable fails that test and forces
 * this paragraph to be rewritten honestly.
 *
 * The bump therefore stands on the semantic change above, alone, which is sufficient on
 * its own.
 *
 * Trade-off accepted: a reader diffing RULE_SET_V1 against RULE_SET_V2 sees identical
 * numbers and must read this comment to learn what changed. That is the accepted cost
 * of versioning semantics rather than values. Do not "fix" the apparent no-op diff by
 * nudging a number; the numbers are correct exactly as printed.
 */
const RULE_SET_V2: ThresholdRuleSet = {
  ...RULE_SET_V1,
  version: 2,
};

/**
 * Every rule set ever shipped, keyed by version. `THRESHOLD_RULE_SETS.get` still
 * reproduces a v1 decision exactly now that v2 has landed, so a threshold change is a
 * detectable and migratable event rather than a silent fork of every judgement on
 * record.
 *
 * A golden test pins `sha256(canonicalJson(THRESHOLD_RULE_SETS.get))`. V1 is a
 * shipped decision and is immutable. Add version 3 for the next change, do not edit
 * version 1 or version 2.
 */
export const THRESHOLD_RULE_SETS: ReadonlyMap<number, ThresholdRuleSet> = new Map([
  [1, RULE_SET_V1],
  [2, RULE_SET_V2],
]);

/** The rule set `THRESHOLD_RULE_SET_VERSION` names. */
export const CURRENT_THRESHOLD_RULE_SET: ThresholdRuleSet = RULE_SET_V2;
